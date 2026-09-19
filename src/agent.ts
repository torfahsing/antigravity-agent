import { GoogleGenAI } from '@google/genai';
import { TOOLS, executeToolCall } from './tools/index.js';
import type { AgentConfig } from './config.js';

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
    return allowedTools.some(
      pat => pat === t.name || (t.name === 'shell' && (pat === 'Bash' || pat === 'shell'))
    );
  });
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
    const err = 'GEMINI_API_KEY is required in environment or via config.';
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
    const toolsConfig = functionDeclarations.length > 0 ? [{ functionDeclarations }] : undefined;

    const stream = await ai.models.generateContentStream({
      model: config.model,
      contents,
      config: {
        systemInstruction: config.systemPrompt,
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
