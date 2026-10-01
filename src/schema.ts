import { existsSync, readFileSync } from 'node:fs';

export type GeminiType =
  | 'STRING' | 'NUMBER' | 'INTEGER' | 'BOOLEAN' | 'ARRAY' | 'OBJECT';

export interface GeminiSchema {
  type: GeminiType;
  description?: string;
  enum?: string[];
  items?: GeminiSchema;
  properties?: Record<string, GeminiSchema>;
  required?: string[];
  nullable?: boolean;
}

export function loadSchemaFile(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) {
    throw new Error(`Output schema file not found: ${filePath}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    throw new Error(`Output schema file is not valid JSON: ${filePath}`);
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Output schema must be a JSON object: ${filePath}`);
  }

  return parsed as Record<string, unknown>;
}