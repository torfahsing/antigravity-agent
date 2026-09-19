import { readdir, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';

export interface ListDirInput {
  path?: string;
  maxDepth?: number;
}

export async function executeListDir(input: ListDirInput, cwd = process.cwd()): Promise<string> {
  const targetPath = input.path ? resolve(cwd, input.path) : cwd;

  try {
    const entries = await readdir(targetPath, { withFileTypes: true });
    const output: string[] = [];

    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const full = join(targetPath, entry.name);
      try {
        const s = await stat(full);
        const type = entry.isDirectory() ? '[dir]' : `[file ${(s.size / 1024).toFixed(1)}k]`;
        output.push(`${type.padEnd(12)} ${entry.name}`);
      } catch {
        output.push(`[unknown]    ${entry.name}`);
      }
    }

    return output.join('\n') || '(Empty directory)';
  } catch (err: any) {
    return JSON.stringify({ error: `Failed to list directory: ${err.message}` });
  }
}
