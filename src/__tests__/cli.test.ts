import { describe, it, expect, afterAll, beforeAll } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadConfig } from '../config.js';

const cliPath = resolve(import.meta.dir, '..', 'cli.ts');

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCli(args: string[], cwd: string): Promise<CliResult> {
  const proc = Bun.spawn([process.execPath, cliPath, ...args], {
    cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, GEMINI_API_KEY: '' },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

describe('antigravity-agent cli output schema', () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'agy-cli-schema-'));
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('lists --output-schema in the help output', async () => {
    const { stdout, exitCode } = await runCli(['--help'], tmpDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('--output-schema <path>');
    expect(stdout).toContain('Path to a JSON Schema constraining the final response');
  });

  it('reports a missing schema file as a JSON error event on stdout with -j', async () => {
    const { stdout, stderr, exitCode } = await runCli(
      ['--output-schema', './missing.json', '-p', 'x', '-j'],
      tmpDir,
    );
    expect(exitCode).toBe(1);
    expect(stderr).toBe('');
    const events = stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('error');
    expect(events[0].message).toBe(
      `Output schema file not found: ${join(tmpDir, 'missing.json')}`,
    );
  });

  it('reports a missing schema file on stderr without -j', async () => {
    const { stdout, stderr, exitCode } = await runCli(
      ['--output-schema', './missing.json', '-p', 'x'],
      tmpDir,
    );
    expect(exitCode).toBe(1);
    expect(stdout).toBe('');
    expect(stderr.trim()).toBe(
      `Error: Output schema file not found: ${join(tmpDir, 'missing.json')}`,
    );
  });

  it('leaves outputSchema undefined when the flag is absent', () => {
    expect(loadConfig({ cwd: tmpDir }).outputSchema).toBeUndefined();
  });

  it('resolves the schema path supplied by the flag against the working directory', async () => {
    await writeFile(join(tmpDir, 'schema.json'), '{"type":"object"}');
    const config = loadConfig({ cwd: tmpDir, outputSchema: './schema.json' });
    expect(config.outputSchema).toBe(join(tmpDir, 'schema.json'));
  });
});