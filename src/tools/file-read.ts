import { resolve } from 'node:path';

export interface FileReadInput {
  path: string;
  offset?: number;
  limit?: number;
}

export async function executeFileRead(input: FileReadInput, cwd = process.cwd()): Promise<string> {
  try {
    const fullPath = resolve(cwd, input.path);
    const file = Bun.file(fullPath);
    const exists = await file.exists();
    if (!exists) {
      return JSON.stringify({ error: `File not found: ${input.path}` });
    }

    const text = await file.text();
    const lines = text.split('\n');
    const offset = Math.max(1, input.offset ?? 1);
    const limit = input.limit ?? lines.length;

    const selectedLines = lines.slice(offset - 1, offset - 1 + limit);
    const numbered = selectedLines.map((line, idx) => `${offset + idx}: ${line}`).join('\n');

    return numbered;
  } catch (err: any) {
    return JSON.stringify({ error: `Failed to read file: ${err.message}` });
  }
}
