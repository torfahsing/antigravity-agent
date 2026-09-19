import { resolve, dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';

export interface FileWriteInput {
  path: string;
  content: string;
}

export async function executeFileWrite(input: FileWriteInput, cwd = process.cwd()): Promise<string> {
  try {
    const fullPath = resolve(cwd, input.path);
    await mkdir(dirname(fullPath), { recursive: true });
    await Bun.write(fullPath, input.content);
    return JSON.stringify({ success: true, path: input.path, bytes: input.content.length });
  } catch (err: any) {
    return JSON.stringify({ error: `Failed to write file: ${err.message}` });
  }
}
