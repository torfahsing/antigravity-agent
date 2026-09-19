import { resolve } from 'node:path';

export interface GlobInput {
  pattern: string;
  path?: string;
}

export async function executeGlob(input: GlobInput, cwd = process.cwd()): Promise<string> {
  const root = input.path ? resolve(cwd, input.path) : cwd;

  try {
    const glob = new Bun.Glob(input.pattern);
    const matches: string[] = [];

    for await (const file of glob.scan({ cwd: root, onlyFiles: true })) {
      if (file.includes('.git/') || file.includes('node_modules/')) continue;
      matches.push(file);
      if (matches.length >= 100) break;
    }

    if (matches.length === 0) {
      return 'No matching files found.';
    }

    return matches.join('\n') + (matches.length >= 100 ? '\n...(capped at 100 files)' : '');
  } catch (err: any) {
    return JSON.stringify({ error: `Glob failed: ${err.message}` });
  }
}
