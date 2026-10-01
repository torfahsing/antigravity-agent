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

const TYPE_MAP: Record<string, GeminiType> = {
  string: 'STRING',
  number: 'NUMBER',
  integer: 'INTEGER',
  boolean: 'BOOLEAN',
  array: 'ARRAY',
  object: 'OBJECT',
};

function normalizeType(raw: string, pointer: string): GeminiType {
  const mapped = TYPE_MAP[raw.toLowerCase()];
  if (!mapped) {
    throw new Error(`Unsupported output schema type "${raw}" at ${pointer}`);
  }
  return mapped;
}

export function toGeminiSchema(node: unknown, pointer = '$'): GeminiSchema {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    throw new Error(`Output schema at ${pointer} must be an object`);
  }
  const src = node as Record<string, unknown>;

  let type: GeminiType;
  let nullable = false;

  if (Array.isArray(src.type)) {
    const entries = (src.type as unknown[]).filter(t => typeof t === 'string') as string[];
    nullable = entries.some(t => t.toLowerCase() === 'null');
    const usable = entries.find(t => t.toLowerCase() !== 'null');
    if (!usable) {
      throw new Error(`Output schema at ${pointer} has no usable type in union`);
    }
    type = normalizeType(usable, pointer);
  } else if (typeof src.type === 'string') {
    if (src.type.toLowerCase() === 'null') {
      throw new Error(`Output schema at ${pointer} has no usable type in union`);
    }
    type = normalizeType(src.type, pointer);
  } else if (src.properties !== undefined) {
    type = 'OBJECT';
  } else if (src.items !== undefined) {
    type = 'ARRAY';
  } else {
    throw new Error(`Output schema at ${pointer} is missing "type"`);
  }

  const out: GeminiSchema = { type };
  if (nullable) out.nullable = true;
  if (typeof src.description === 'string') out.description = src.description;
  if (Array.isArray(src.enum)) out.enum = (src.enum as unknown[]).map(e => String(e));
  if (Array.isArray(src.required)) out.required = (src.required as unknown[]).map(r => String(r));
  if (src.properties !== undefined && src.properties !== null) {
    const props = src.properties as Record<string, unknown>;
    out.properties = {};
    for (const key of Object.keys(props)) {
      out.properties[key] = toGeminiSchema(props[key], `${pointer}.${key}`);
    }
  }
  if (src.items !== undefined) {
    out.items = toGeminiSchema(src.items, `${pointer}[]`);
  }

  return out;
}