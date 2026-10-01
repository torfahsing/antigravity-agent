import { describe, it, expect, beforeAll, afterAll, beforeEach, mock } from 'bun:test';
import { EventEmitter } from 'node:events';
import * as realChildProcess from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, type AgentConfig } from '../config.js';
import * as realSandbox from '../sandbox.js';
import type { AgentEvent } from '../agent.js';

interface SpawnCall {
  command: string;
  args: string[];
  options: { cwd?: string; env?: Record<string, string> };
}

const schema = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
  },
  required: ['answer'],
};

const spawnCalls: SpawnCall[] = [];
let agyResponse = '';
let agyExitCode = 0;
let sandboxCleanups = 0;

function createFakeAgyProcess(response: string, exitCode: number) {
  const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  // Emit after runWithAgy has attached its stream and close listeners.
  setTimeout(() => {
    if (response) {
      const ndjson = [
        JSON.stringify({ event: 'step_update', step_update: { step_type: 'text', text_delta: response } }),
        JSON.stringify({
          event: 'result',
          result: { response, usage: { input_tokens: 3, output_tokens: 5, total_tokens: 8 } },
        }),
        '',
      ].join('\n');
      proc.stdout.emit('data', Buffer.from(ndjson, 'utf-8'));
    }
    proc.emit('close', exitCode);
  }, 0);
  return proc;
}

mock.module('node:child_process', () => ({
  ...realChildProcess,
  spawnSync: (command: string, args: string[]) =>
    command === 'which' && args[0] === 'agy'
      ? { status: 0, stdout: '/usr/bin/agy\n', stderr: '' }
      : { status: 1, stdout: '', stderr: '' },
  spawn: (command: string, args: string[], options: { cwd?: string; env?: Record<string, string> }) => {
    spawnCalls.push({ command, args, options });
    return createFakeAgyProcess(agyResponse, agyExitCode);
  },
}));

mock.module('../sandbox.js', () => ({
  setupAgySandbox: async () => ({
    sandboxDir: join(tmpdir(), 'agy-sandbox-fake'),
    env: { HOME: join(tmpdir(), 'agy-sandbox-fake') },
    cleanup: async () => {
      sandboxCleanups++;
    },
  }),
}));

const { runAgent } = await import('../agent.js');

describe('antigravity-agent agy output schema', () => {
  let tmpDir: string;
  let schemaPath: string;
  let savedKeys: Record<string, string | undefined>;

  const events: AgentEvent[] = [];
  const onEvent = (event: AgentEvent) => events.push(event);

  function config(overrides: Partial<AgentConfig> = {}): AgentConfig {
    return loadConfig({ cwd: tmpDir, apiKey: '', maxSteps: 3, ...overrides });
  }

  beforeAll(async () => {
    // Force the agy fallback branch, which loadConfig only reaches with no API key.
    savedKeys = {
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
    };
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;

    tmpDir = await mkdtemp(join(tmpdir(), 'agy-cli-schema-'));
    schemaPath = join(tmpDir, 'schema.json');
    await writeFile(schemaPath, JSON.stringify(schema));
  });

  afterAll(async () => {
    // Put the real modules back so test files running later are unaffected.
    mock.module('node:child_process', () => realChildProcess);
    mock.module('../sandbox.js', () => realSandbox);
    for (const [key, value] of Object.entries(savedKeys)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await rm(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    spawnCalls.length = 0;
    events.length = 0;
    sandboxCleanups = 0;
    agyExitCode = 0;
    agyResponse = '';
  });

  it('falls back to agy when no API key is configured', async () => {
    agyResponse = 'plain answer';
    const text = await runAgent(config(), 'prompt', { onEvent });

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].command).toBe('agy');
    expect(spawnCalls[0].options.cwd).toBe(tmpDir);
    expect(text).toBe('plain answer');
    expect(sandboxCleanups).toBe(1);
  });

  it('passes --json-schema with the absolute schema path to agy', async () => {
    agyResponse = '{"answer":"42","tags":["a"]}';
    await runAgent(config({ model: 'gemini-test', outputSchema: './schema.json' }), 'prompt', { onEvent });

    const args = spawnCalls[0].args;
    const flagIndex = args.indexOf('--json-schema');
    expect(flagIndex).toBeGreaterThan(-1);
    expect(args[flagIndex + 1]).toBe(schemaPath);
    expect(args[args.indexOf('--model') + 1]).toBe('gemini-test');
    expect(flagIndex).toBeGreaterThan(args.indexOf('--model'));
  });

  it('omits --json-schema entirely when no schema is configured', async () => {
    agyResponse = 'plain answer';
    await runAgent(config(), 'prompt', { onEvent });

    const args = spawnCalls[0].args;
    expect(args).not.toContain('--json-schema');
    expect(args.every(arg => arg.trim().length > 0)).toBe(true);
  });

  it('resolves with the agy text and emits no error for conforming output', async () => {
    agyResponse = '{"answer":"42","tags":["a"]}';
    const text = await runAgent(config({ outputSchema: './schema.json' }), 'prompt', { onEvent });

    expect(text).toBe(agyResponse);
    expect(events.filter(ev => ev.type === 'error')).toHaveLength(0);
    expect(events.some(ev => ev.type === 'done')).toBe(true);
  });

  it('emits an error and throws when agy output violates the schema', async () => {
    agyResponse = '{"answer":42}';
    await expect(runAgent(config({ outputSchema: './schema.json' }), 'prompt', { onEvent }))
      .rejects.toThrow('Output does not match schema: ');

    const errorEvents = events.filter(ev => ev.type === 'error');
    expect(errorEvents).toHaveLength(1);
    expect((errorEvents[0] as { message: string }).message).toContain('$.answer');
    expect((errorEvents[0] as { message: string }).message).toContain('expected string');
  });

  it('reports non-JSON agy output as invalid JSON', async () => {
    agyResponse = 'not json at all';
    await expect(runAgent(config({ outputSchema: './schema.json' }), 'prompt', { onEvent }))
      .rejects.toThrow('not valid JSON');

    const errorEvents = events.filter(ev => ev.type === 'error');
    expect((errorEvents[0] as { message: string }).message).toContain('not valid JSON');
  });
});
