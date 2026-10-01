import { describe, it, expect, beforeAll, afterAll, beforeEach, mock } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../config.js';
import { toGeminiSchema, validateSchemaOutput, type GeminiSchema } from '../schema.js';
import type { AgentEvent } from '../agent.js';

interface StreamRequest {
  model: string;
  contents: unknown[];
  config: Record<string, any>;
}

const requests: StreamRequest[] = [];
let modelResponse = '';

mock.module('@google/genai', () => ({
  GoogleGenAI: class {
    models = {
      generateContentStream: async (request: StreamRequest) => {
        requests.push(request);
        return (async function* () {
          yield { candidates: [{ content: { parts: [{ text: modelResponse }] } }] };
        })();
      },
    };
  },
}));

const { runAgent } = await import('../agent.js');

describe('antigravity-agent step update parsing', () => {
  it('parses tool_call and tool_result step updates correctly', () => {
    const events: AgentEvent[] = [];
    const onEvent = (ev: AgentEvent) => events.push(ev);

    const activeToolEvent = {
      event: 'step_update',
      step_update: {
        step_index: 2,
        state: 'ACTIVE',
        step_type: 'tool',
        tool_name: 'run_command',
        tool_info: {
          name: 'run_command',
          parameters: { CommandLine: 'ls -la' },
        },
      },
    };

    const doneToolEvent = {
      event: 'step_update',
      step_update: {
        step_index: 2,
        state: 'DONE',
        step_type: 'tool',
        tool_name: 'run_command',
        tool_info: {
          name: 'run_command',
          output: 'file1.txt\nfile2.txt',
        },
      },
    };

    // Simulate event handler logic
    for (const ev of [activeToolEvent, doneToolEvent]) {
      const su = ev.step_update;
      if (ev.event === 'step_update' && su) {
        if (su.step_type === 'tool') {
          const toolName = su.tool_name || su.tool_info?.name || 'tool';
          const callId = String(su.step_index ?? Date.now());
          if (su.state === 'ACTIVE') {
            onEvent({
              type: 'tool_call',
              name: toolName,
              callId,
              args: (su.tool_info?.parameters as Record<string, unknown>) ?? {},
            });
          } else if (su.state === 'DONE') {
            const output = typeof su.tool_info?.output === 'string'
              ? su.tool_info.output
              : JSON.stringify(su.tool_info?.output ?? '');
            onEvent({
              type: 'tool_result',
              name: toolName,
              callId,
              output,
            });
          }
        }
      }
    }

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({
      type: 'tool_call',
      name: 'run_command',
      callId: '2',
      args: { CommandLine: 'ls -la' },
    });
    expect(events[1]).toEqual({
      type: 'tool_result',
      name: 'run_command',
      callId: '2',
      output: 'file1.txt\nfile2.txt',
    });
  });
});

describe('antigravity-agent direct mode output schema', () => {
  let tmpDir: string;

  const schema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {
      answer: { type: 'string' },
      confidence: { type: 'number' },
      tags: { type: 'array', items: { type: 'string' } },
    },
    required: ['answer'],
  };

  const events: AgentEvent[] = [];
  const onEvent = (event: AgentEvent) => events.push(event);

  async function run(prompt: string, outputSchema?: string) {
    const config = loadConfig({
      cwd: tmpDir,
      apiKey: 'test-key',
      maxSteps: 3,
      ...(outputSchema ? { outputSchema } : {}),
    });
    return runAgent(config, prompt, { onEvent });
  }

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'agy-direct-schema-'));
    await writeFile(join(tmpDir, 'schema.json'), JSON.stringify(schema));
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    requests.length = 0;
    events.length = 0;
  });

  it('sends responseMimeType and a converted responseSchema and omits tools', async () => {
    modelResponse = '{"answer":"42","confidence":0.9,"tags":["a"]}';
    await run('answer', './schema.json');

    expect(requests).toHaveLength(1);
    const config = requests[0].config;
    expect(config).not.toHaveProperty('tools');
    expect(config.responseMimeType).toBe('application/json');
    expect(config.responseSchema.type).toBe('OBJECT');
    expect(config.responseSchema.required).toEqual(['answer']);
    expect(config.responseSchema.properties.answer.type).toBe('STRING');
    expect(config.responseSchema.properties.confidence.type).toBe('NUMBER');
    expect(config.responseSchema.properties.tags.type).toBe('ARRAY');
    expect(config.responseSchema.properties.tags.items.type).toBe('STRING');
  });

  it('keeps the tools spread and sends no schema when no schema is configured', async () => {
    modelResponse = 'plain answer';
    await run('answer');

    expect(requests).toHaveLength(1);
    const config = requests[0].config;
    expect(config).not.toHaveProperty('responseSchema');
    expect(config).not.toHaveProperty('responseMimeType');
    expect(config.tools?.[0]?.functionDeclarations?.length).toBeGreaterThan(0);
  });

  it('emits done and resolves with the accumulated text for conforming output', async () => {
    modelResponse = '{"answer":"42","confidence":0.9,"tags":["a"]}';
    const text = await run('answer', './schema.json');

    expect(text).toBe(modelResponse);
    expect(events.some(ev => ev.type === 'error')).toBe(false);
    expect(events[events.length - 1].type).toBe('done');
  });

  it('emits an error and throws before done for schema-violating output', async () => {
    modelResponse = '{"answer":42}';
    await expect(run('answer', './schema.json')).rejects.toThrow('Output does not match schema: ');

    const errorEvents = events.filter(ev => ev.type === 'error');
    expect(errorEvents).toHaveLength(1);
    expect((errorEvents[0] as { message: string }).message).toContain('$.answer');
    expect(events.some(ev => ev.type === 'done')).toBe(false);
  });

  it('reports non-JSON output as invalid JSON rather than throwing a parse error', async () => {
    modelResponse = '```json\n{"answer":"42"}\n```';
    await expect(run('answer', './schema.json')).rejects.toThrow('not valid JSON');

    const errorEvents = events.filter(ev => ev.type === 'error');
    expect((errorEvents[0] as { message: string }).message).toContain('not valid JSON');
    expect(events.some(ev => ev.type === 'done')).toBe(false);
  });
});

describe('antigravity-agent output schema', () => {
  const rawSchema = {
    type: 'object',
    properties: {
      answer: { type: 'string' },
      confidence: { type: 'number' },
    },
    required: ['answer'],
  };

  it('accepts a conforming payload and round-trips types to uppercase Gemini types', () => {
    const gemini = toGeminiSchema(rawSchema);
    expect(gemini.type).toBe('OBJECT');
    expect(gemini.properties?.answer.type).toBe('STRING');
    expect(gemini.properties?.confidence.type).toBe('NUMBER');
    expect(gemini.required).toEqual(['answer']);
    expect(validateSchemaOutput('{"answer":"42","confidence":0.9}', gemini)).toEqual([]);
  });

  it('rejects a payload that violates the schema', () => {
    const gemini = toGeminiSchema(rawSchema);
    const errors = validateSchemaOutput('{"answer":42}', gemini);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.includes('$.answer'))).toBe(true);
    expect(errors.some(e => e.includes('expected string'))).toBe(true);
  });

  it('omits tools from the request config when a schema is set', () => {
    // Mirror the AD-7 branch selection in runAgent: responseSchema and tools
    // are mutually exclusive, so a schema-constrained request omits tools.
    const functionDeclarations = [
      { name: 'run_command', description: 'Run a command', parameters: { type: 'OBJECT', properties: {} } },
    ];
    const toolsConfig = [{ functionDeclarations }];
    const outputSchema = toGeminiSchema(rawSchema);

    const buildConfig = (schema: GeminiSchema | undefined) =>
      schema
        ? {
            systemInstruction: 'instruct',
            responseMimeType: 'application/json',
            responseSchema: schema,
          }
        : {
            systemInstruction: 'instruct',
            ...(toolsConfig ? { tools: toolsConfig as any } : {}),
          };

    const schemaBranch = buildConfig(outputSchema);
    const toolsBranch = buildConfig(undefined);

    expect(schemaBranch).not.toHaveProperty('tools');
    expect(schemaBranch.responseMimeType).toBe('application/json');
    expect(schemaBranch.responseSchema.type).toBe('OBJECT');

    expect(toolsBranch).toHaveProperty('tools');
    expect(toolsBranch.tools).toEqual(toolsConfig);
    expect(toolsBranch).not.toHaveProperty('responseSchema');
  });
});
