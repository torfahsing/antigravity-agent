import { describe, it, expect, afterEach } from 'bun:test';
import { setupAgySandbox, type AgySandbox } from '../sandbox.js';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

describe('antigravity-agent sandbox', () => {
  let sandbox: AgySandbox | null = null;

  afterEach(async () => {
    if (sandbox) {
      await sandbox.cleanup();
      sandbox = null;
    }
  });

  it('creates an isolated sandbox directory and configures hooks', async () => {
    sandbox = await setupAgySandbox(['file_read', 'grep']);
    expect(existsSync(sandbox.sandboxDir)).toBe(true);
    expect(sandbox.env.HOME).toBe(sandbox.sandboxDir);
    expect(sandbox.env.AGY_ROLE_ACTIVE).toBe('true');
    expect(sandbox.env.AGY_ALLOWED_TOOLS).toBe('file_read,grep');

    const configDir = path.join(sandbox.sandboxDir, '.gemini', 'config');
    expect(existsSync(path.join(configDir, 'hooks.json'))).toBe(true);
    expect(existsSync(path.join(configDir, 'gate.cjs'))).toBe(true);

    await sandbox.cleanup();
    expect(existsSync(sandbox.sandboxDir)).toBe(false);
    sandbox = null;
  });

  function runGate(sandbox: AgySandbox, toolCall: { name: string; args?: Record<string, any> }) {
    const gatePath = path.join(sandbox.sandboxDir, '.gemini', 'config', 'gate.cjs');
    const input = JSON.stringify({ toolCall });
    const stdout = execFileSync('node', [gatePath], {
      env: { ...process.env, ...sandbox.env },
      input,
      encoding: 'utf-8',
    });
    return JSON.parse(stdout.trim());
  }

  it('denies all tools when allowedTools is empty or none', async () => {
    sandbox = await setupAgySandbox([]);
    const res = runGate(sandbox, { name: 'view_file', args: { path: 'test.ts' } });
    expect(res.decision).toBe('deny');
    expect(res.reason).toContain('does not permit any tool');

    const res2 = runGate(sandbox, { name: 'write_to_file', args: { path: 'test.ts' } });
    expect(res2.decision).toBe('deny');
  });

  it('allows read tools and denies write tools for read-only role', async () => {
    sandbox = await setupAgySandbox(['file_read', 'list_dir', 'grep']);

    const readRes = runGate(sandbox, { name: 'view_file', args: { path: 'test.ts' } });
    expect(readRes.decision).toBe('allow');

    const listRes = runGate(sandbox, { name: 'list_dir', args: { path: '.' } });
    expect(listRes.decision).toBe('allow');

    const writeRes = runGate(sandbox, { name: 'write_to_file', args: { path: 'test.ts' } });
    expect(writeRes.decision).toBe('deny');
    expect(writeRes.reason).toContain('forbids file modifications');
  });

  it('allows write tools when file_write is permitted', async () => {
    sandbox = await setupAgySandbox(['file_read', 'file_write', 'file_edit']);

    const writeRes = runGate(sandbox, { name: 'write_to_file', args: { path: 'test.ts' } });
    expect(writeRes.decision).toBe('allow');

    const editRes = runGate(sandbox, { name: 'replace_file_content', args: { path: 'test.ts' } });
    expect(editRes.decision).toBe('allow');
  });

  it('enforces shell command patterns', async () => {
    sandbox = await setupAgySandbox(['file_read', 'shell(git *)']);

    const gitRes = runGate(sandbox, {
      name: 'run_command',
      args: { CommandLine: 'git status' },
    });
    expect(gitRes.decision).toBe('allow');

    const dangerRes = runGate(sandbox, {
      name: 'run_command',
      args: { CommandLine: 'rm -rf /' },
    });
    expect(dangerRes.decision).toBe('deny');
    expect(dangerRes.reason).toContain('not permitted');
  });

  it('allows arbitrary custom tools when present in allowed_tools', async () => {
    sandbox = await setupAgySandbox(['file_read', 'cdp', 'custom_tool']);

    const cdpRes = runGate(sandbox, { name: 'cdp', args: { action: 'click' } });
    expect(cdpRes.decision).toBe('allow');

    const otherRes = runGate(sandbox, { name: 'unknown_tool' });
    expect(otherRes.decision).toBe('deny');
  });
});
