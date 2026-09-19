import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { executeToolCall, TOOLS } from '../tools/index.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('antigravity-agent tools', () => {
  let testDir: string;

  beforeAll(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'agy-agent-test-'));
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('exposes all expected tools in manifest', () => {
    const names = TOOLS.map(t => t.name);
    expect(names).toContain('file_read');
    expect(names).toContain('file_write');
    expect(names).toContain('file_edit');
    expect(names).toContain('shell');
    expect(names).toContain('grep');
    expect(names).toContain('glob');
    expect(names).toContain('list_dir');
  });

  it('executes file_write and file_read correctly', async () => {
    const writeRes = await executeToolCall(
      'file_write',
      { path: 'hello.txt', content: 'line 1\nline 2\nline 3' },
      undefined,
      testDir
    );
    expect(JSON.parse(writeRes).success).toBe(true);

    const readRes = await executeToolCall(
      'file_read',
      { path: 'hello.txt', offset: 2, limit: 1 },
      undefined,
      testDir
    );
    expect(readRes).toContain('2: line 2');
  });

  it('executes file_edit correctly', async () => {
    const editRes = await executeToolCall(
      'file_edit',
      { path: 'hello.txt', targetContent: 'line 2', replacementContent: 'line 2 updated' },
      undefined,
      testDir
    );
    expect(JSON.parse(editRes).success).toBe(true);

    const readRes = await executeToolCall('file_read', { path: 'hello.txt' }, undefined, testDir);
    expect(readRes).toContain('line 2 updated');
  });

  it('blocks disallowed tools when allowedTools is supplied', async () => {
    const res = await executeToolCall(
      'shell',
      { command: 'echo 123' },
      ['file_read', 'grep'],
      testDir
    );
    const parsed = JSON.parse(res);
    expect(parsed.error).toContain('blocked by allowedTools');
  });

  it('allows permitted tools when allowedTools is supplied', async () => {
    const res = await executeToolCall(
      'shell',
      { command: 'echo "hello from shell"' },
      ['shell'],
      testDir
    );
    expect(res).toContain('hello from shell');
  });

  it('blocks all tools when allowedTools contains none', async () => {
    const res = await executeToolCall(
      'file_read',
      { path: 'hello.txt' },
      ['none'],
      testDir
    );
    const parsed = JSON.parse(res);
    expect(parsed.error).toContain('all tools are disabled');
  });
});
