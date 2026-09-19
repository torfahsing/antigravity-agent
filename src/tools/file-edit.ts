import { resolve } from 'node:path';

export interface FileEditInput {
  path: string;
  targetContent: string;
  replacementContent: string;
}

export async function executeFileEdit(input: FileEditInput, cwd = process.cwd()): Promise<string> {
  try {
    const fullPath = resolve(cwd, input.path);
    const file = Bun.file(fullPath);
    const exists = await file.exists();
    if (!exists) {
      return JSON.stringify({ error: `File not found: ${input.path}` });
    }

    const content = await file.text();
    const occurrences = content.split(input.targetContent).length - 1;

    if (occurrences === 0) {
      return JSON.stringify({ error: `Target content not found in file: ${input.path}` });
    }
    if (occurrences > 1) {
      return JSON.stringify({
        error: `Target content found ${occurrences} times. Must match uniquely. Include more surrounding lines.`
      });
    }

    const updated = content.replace(input.targetContent, input.replacementContent);
    await Bun.write(fullPath, updated);
    return JSON.stringify({ success: true, path: input.path });
  } catch (err: any) {
    return JSON.stringify({ error: `Failed to edit file: ${err.message}` });
  }
}
