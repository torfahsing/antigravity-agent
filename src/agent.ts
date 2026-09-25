import { spawn, spawnSync } from 'node:child_process';
import { GoogleGenAI } from '@google/genai';
import { TOOLS, executeToolCall, normalizeToolName } from './tools/index.js';
import type { AgentConfig } from './config.js';
import { setupAgySandbox } from './sandbox.js';

export interface DoneUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
  cost?: number | null;
}

export type AgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'tool_call'; name: string; callId: string; args: Record<string, unknown> }
  | { type: 'tool_result'; name: string; callId: string; output: string }
  | { type: 'turn_end' }
  | { type: 'done'; usage?: DoneUsage; durationMs: number }
  | { type: 'error'; message: string };

function filterTools(allowedTools?: string[]) {
  if (!allowedTools || allowedTools.length === 0) {
    return TOOLS;
  }
  if (allowedTools.includes('none')) {
    return [];
  }
  return TOOLS.filter(t => {
    const canonical = normalizeToolName(t.name);
    return allowedTools.some(
      pat => pat === t.name || pat === canonical || (canonical === 'shell' && (pat === 'Bash' || pat === 'shell'))
    );
  });
}

async function runWithAgy(
  config: AgentConfig,
  prompt: string,
  options?: { onEvent?: (event: AgentEvent) => void }
): Promise<string> {
  const startTime = Date.now();
  const sandbox = await setupAgySandbox(config.allowedTools ?? []);
  const args = ['-p', prompt, '--output-format', 'stream-json', '--dangerously-skip-permissions'];
  if (config.model) {
    args.push('--model', config.model);
    if (config.model.includes('3.8')) {
      args.push('--effort', 'low');
    }
  }
  const proc = spawn('agy', args, {
    cwd: config.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...sandbox.env },
  });

  let accumulatedText = '';
  let lineBuffer = '';

  try {
    return await new Promise<string>((resolve, reject) => {
    proc.stdout?.on('data', (chunk: Buffer) => {
      lineBuffer += chunk.toString();
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop()!;
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const ev = JSON.parse(line);
          if (ev.event === 'step_update' && ev.step_update?.text_delta) {
            const delta = ev.step_update.text_delta;
            accumulatedText += delta;
            options?.onEvent?.({ type: 'text', delta });
          } else if (ev.event === 'result') {
            if (ev.result?.response && !accumulatedText) {
              accumulatedText = ev.result.response;
            }
            options?.onEvent?.({
              type: 'done',
              usage: {
                inputTokens: ev.result?.usage?.input_tokens ?? 0,
                outputTokens: ev.result?.usage?.output_tokens ?? 0,
                totalTokens: ev.result?.usage?.total_tokens ?? 0,
                cost: 0,
              },
              durationMs: Date.now() - startTime,
            });
          }
        } catch {
          // ignore
        }
      }
    });

    let stderr = '';
    proc.stderr?.on('data', chunk => { stderr += chunk.toString(); });

    proc.on('close', code => {
      if (code === 0) {
        resolve(accumulatedText);
      } else {
        const msg = stderr || `agy exited with code ${code}`;
        options?.onEvent?.({ type: 'error', message: msg });
        reject(new Error(msg));
      }
    });

    proc.on('error', err => {
      options?.onEvent?.({ type: 'error', message: err.message });
      reject(err);
    });
  });
  } finally {
    await sandbox.cleanup();
  }
}

export async function runAgent(
  config: AgentConfig,
  prompt: string,
  options?: { onEvent?: (event: AgentEvent) => void }
): Promise<string> {
  const startTime = Date.now();
  let accumulatedText = '';
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  if (!config.apiKey) {
    const agyCheck = spawnSync('which', ['agy']);
    if (agyCheck.status === 0) {
      return runWithAgy(config, prompt, options);
    }
    const err = 'GEMINI_API_KEY is required in environment or via config, or `agy` CLI must be installed.';
    options?.onEvent?.({ type: 'error', message: err });
    throw new Error(err);
  }

  const ai = new GoogleGenAI({ apiKey: config.apiKey });
  const activeTools = filterTools(config.allowedTools);

  const functionDeclarations = activeTools.map(t => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters as any,
  }));

  const contents: any[] = [
    {
      role: 'user',
      parts: [{ text: prompt }],
    },
  ];

  let step = 0;

  while (step < config.maxSteps) {
    step++;
    const toolNames = activeTools.map(t => t.name).join(', ');
    const systemInstruction = [
      config.systemPrompt,
      toolNames ? `When using tools, you MUST ONLY use the exact tool names provided in your tools schema (${toolNames}). Do not invent or call nonexistent tools.` : '',
    ].filter(Boolean).join('\n\n');

    const stream = await ai.models.generateContentStream({
      model: config.model,
      contents,
      config: {
        systemInstruction: systemInstruction || undefined,
        ...(toolsConfig ? { tools: toolsConfig as any } : {}),
      },
    });

    let currentTurnText = '';
    const toolCallsToExecute: Array<{ name: string; callId: string; args: Record<string, any> }> = [];

    for await (const chunk of stream) {
      if (chunk.usageMetadata) {
        if (chunk.usageMetadata.promptTokenCount) totalInputTokens += chunk.usageMetadata.promptTokenCount;
        if (chunk.usageMetadata.candidatesTokenCount) totalOutputTokens += chunk.usageMetadata.candidatesTokenCount;
      }

      const candidate = chunk.candidates?.[0];
      if (!candidate?.content?.parts) continue;

      for (const part of candidate.content.parts) {
        if (part.text) {
          currentTurnText += part.text;
          accumulatedText += part.text;
          options?.onEvent?.({ type: 'text', delta: part.text });
        }
        if (part.functionCall) {
          const callId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
          const call = {
            name: part.functionCall.name,
            callId,
            args: (part.functionCall.args as Record<string, any>) || {},
          };
          toolCallsToExecute.push(call);
          options?.onEvent?.({
            type: 'tool_call',
            name: call.name,
            callId: call.callId,
            args: call.args,
          });
        }
      }
    }

    options?.onEvent?.({ type: 'turn_end' });

    // If no tool calls, conversation turn is done
    if (toolCallsToExecute.length === 0) {
      break;
    }

    // Add model's assistant turn to history
    const modelParts: any[] = [];
    if (currentTurnText) {
      modelParts.push({ text: currentTurnText });
    }
    for (const tc of toolCallsToExecute) {
      modelParts.push({
        functionCall: {
          name: tc.name,
          args: tc.args,
        },
      });
    }
    contents.push({
      role: 'model',
      parts: modelParts,
    });

    // Execute each tool and collect responses
    const responseParts: any[] = [];
    for (const tc of toolCallsToExecute) {
      const output = await executeToolCall(tc.name, tc.args, config.allowedTools, config.cwd);
      options?.onEvent?.({
        type: 'tool_result',
        name: tc.name,
        callId: tc.callId,
        output,
      });

      let parsedResponse: any;
      try {
        parsedResponse = JSON.parse(output);
      } catch {
        parsedResponse = { output };
      }

      responseParts.push({
        functionResponse: {
          name: tc.name,
          response: parsedResponse,
        },
      });
    }

    contents.push({
      role: 'user',
      parts: responseParts,
    });
  }

  const durationMs = Date.now() - startTime;
  options?.onEvent?.({
    type: 'done',
    durationMs,
    usage: {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      totalTokens: totalInputTokens + totalOutputTokens,
      cost: 0,
    },
  });

  return accumulatedText;
}
