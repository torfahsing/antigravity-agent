import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toGeminiSchema, validateAgainstSchema, validateSchemaOutput, loadSchemaFile } from '../schema.js';
import { loadConfig } from '../config.js';

describe('validateAgainstSchema', () => {
  const userSchema = toGeminiSchema({
    type: 'object',
    properties: {
      user: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'integer' },
        },
        required: ['name'],
      },
      tags: { type: 'array', items: { type: 'string' } },
      score: { type: 'number' },
      active: { type: 'boolean' },
    },
    required: ['user', 'tags'],
  });

  it('returns an empty array for a conforming value', () => {
    const value = {
      user: { name: 'ada', age: 36 },
      tags: ['a', 'b'],
      score: 0.5,
      active: true,
    };
    expect(validateAgainstSchema(value, userSchema)).toEqual([]);
  });

  it('ignores properties that are not declared in the schema', () => {
    expect(validateAgainstSchema({ user: { name: 'ada' }, tags: [], extra: 1 }, userSchema))
      .toEqual([]);
  });

  it('reports a missing required property', () => {
    const errors = validateAgainstSchema({ tags: [] }, userSchema);
    expect(errors.some(e => e.includes('missing required property'))).toBe(true);
    expect(errors.some(e => e.includes('"user"'))).toBe(true);
  });

  it('reports a wrong scalar type', () => {
    const errors = validateAgainstSchema({ user: { name: 1 }, tags: [] }, userSchema);
    expect(errors).toEqual(['$.user.name: expected string, received integer']);
  });

  it('reports a non-object where an object is required', () => {
    expect(validateAgainstSchema('nope', userSchema))
      .toEqual(['$: expected object, received string']);
    expect(validateAgainstSchema([], userSchema))
      .toEqual(['$: expected object, received array']);
    expect(validateAgainstSchema(null, userSchema))
      .toEqual(['$: expected object, received null']);
  });

  it('reports nested object mismatches with the full path', () => {
    const errors = validateAgainstSchema({ user: { name: 'ada', age: 1.5 }, tags: [] }, userSchema);
    expect(errors).toEqual(['$.user.age: expected integer, received number']);
  });

  it('reports array element mismatches with an indexed path', () => {
    const errors = validateAgainstSchema({ user: { name: 'ada' }, tags: ['ok', 2] }, userSchema);
    expect(errors).toEqual(['$.tags[1]: expected string, received integer']);
  });

  it('reports a non-array where an array is required', () => {
    const errors = validateAgainstSchema({ user: { name: 'ada' }, tags: 'nope' }, userSchema);
    expect(errors).toEqual(['$.tags: expected array, received string']);
  });

  it('rejects a boolean that is not a boolean', () => {
    const schema = toGeminiSchema({ type: 'boolean' });
    expect(validateAgainstSchema('true', schema)).toEqual(['$: expected boolean, received string']);
    expect(validateAgainstSchema(true, schema)).toEqual([]);
  });

  it('rejects a non-finite number', () => {
    const schema = toGeminiSchema({ type: 'number' });
    expect(validateAgainstSchema('1', schema)).toEqual(['$: expected number, received string']);
    expect(validateAgainstSchema(Number.NaN, schema)).toEqual(['$: expected number, received number']);
    expect(validateAgainstSchema(1.5, schema)).toEqual([]);
  });

  it('rejects a value outside an enum', () => {
    const schema = toGeminiSchema({ type: 'string', enum: ['low', 'high'] });
    expect(validateAgainstSchema('medium', schema)).toEqual([
      '$: value is not one of ["low","high"]',
    ]);
    expect(validateAgainstSchema('low', schema)).toEqual([]);
  });

  it('reports both the type error and the enum error for a doubly invalid value', () => {
    const schema = toGeminiSchema({ type: 'string', enum: ['low', 'high'] });
    expect(validateAgainstSchema(1, schema)).toEqual([
      '$: expected string, received integer',
      '$: value is not one of ["low","high"]',
    ]);
  });

  it('accepts null for every type when nullable is set', () => {
    expect(validateAgainstSchema(null, { type: 'STRING', nullable: true })).toEqual([]);
    expect(validateAgainstSchema(null, { type: 'OBJECT', nullable: true })).toEqual([]);
    expect(validateAgainstSchema(null, { type: 'ARRAY', nullable: true })).toEqual([]);
    expect(validateAgainstSchema(null, { type: 'INTEGER', nullable: true })).toEqual([]);
    expect(validateAgainstSchema(null, { type: 'BOOLEAN', nullable: true })).toEqual([]);
    expect(validateAgainstSchema(null, { type: 'NUMBER', nullable: true })).toEqual([]);
  });

  it('does not accept null when nullable is not set', () => {
    expect(validateAgainstSchema(null, { type: 'STRING' }))
      .toEqual(['$: expected string, received null']);
  });

  it('never throws for unusual values', () => {
    const schema = toGeminiSchema({ type: 'array', items: { type: 'object' } });
    expect(validateAgainstSchema(undefined, schema)).toEqual([
      '$: expected array, received undefined',
    ]);
    expect(validateAgainstSchema([undefined, null, 1, 'x', [], {}], schema)).toEqual([
      '$[0]: expected object, received undefined',
      '$[1]: expected object, received null',
      '$[2]: expected object, received integer',
      '$[3]: expected object, received string',
      '$[4]: expected object, received array',
    ]);
  });
});

describe('validateSchemaOutput', () => {
  const schema = toGeminiSchema({
    type: 'object',
    properties: { answer: { type: 'string' } },
    required: ['answer'],
  });

  it('returns an empty array for conforming JSON text', () => {
    expect(validateSchemaOutput('{"answer":"42"}', schema)).toEqual([]);
  });

  it('reports structural violations in the parsed output', () => {
    const errors = validateSchemaOutput('{"answer":42}', schema);
    expect(errors).toEqual(['$.answer: expected string, received integer']);
  });

  it('reports missing required properties', () => {
    const errors = validateSchemaOutput('{}', schema);
    expect(errors.some(e => e.includes('missing required property'))).toBe(true);
  });

  it('reports empty output', () => {
    expect(validateSchemaOutput('', schema).some(e => e.includes('output is empty'))).toBe(true);
    expect(validateSchemaOutput('   \n ', schema).some(e => e.includes('output is empty'))).toBe(true);
  });

  it('reports non-JSON output', () => {
    const errors = validateSchemaOutput('not json', schema);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('output is not valid JSON');
  });

  it('does not strip code fences', () => {
    const errors = validateSchemaOutput('```json\n{"answer":"42"}\n```', schema);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('not valid JSON');
  });

  it('end-to-end: validating a string-answer schema succeeds for conforming JSON', () => {
    const e2eSchema = toGeminiSchema({
      type: 'object',
      properties: { answer: { type: 'string' } },
      required: ['answer'],
    });
    expect(validateSchemaOutput('{"answer":"42"}', e2eSchema)).toEqual([]);
  });

  it('end-to-end: rejecting an integer where a string is expected', () => {
    const e2eSchema = toGeminiSchema({
      type: 'object',
      properties: { answer: { type: 'string' } },
      required: ['answer'],
    });
    const errors = validateSchemaOutput('{"answer":42}', e2eSchema);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.includes('$.answer'))).toBe(true);
  });
});

let schemaTmpDir: string;
afterAll(async () => {
  if (schemaTmpDir) {
    await rm(schemaTmpDir, { recursive: true, force: true });
  }
});

describe('loadSchemaFile', () => {
  beforeAll(async () => {
    schemaTmpDir = await mkdtemp(join(tmpdir(), 'agy-schema-test-'));
  });

  it('throws when the file does not exist', () => {
    const missingPath = join(schemaTmpDir, 'nonexistent.json');
    expect(() => loadSchemaFile(missingPath)).toThrow(
      'Output schema file not found: ' + missingPath,
    );
  });

  it('throws when the file contains invalid JSON', () => {
    const badPath = join(schemaTmpDir, 'bad.json');
    writeFileSync(badPath, 'not json');
    expect(() => loadSchemaFile(badPath)).toThrow(
      'Output schema file is not valid JSON: ' + badPath,
    );
  });

  it('throws when the file parses to a non-object (array)', () => {
    const arrPath = join(schemaTmpDir, 'array.json');
    writeFileSync(arrPath, '[]');
    expect(() => loadSchemaFile(arrPath)).toThrow(
      'Output schema must be a JSON object: ' + arrPath,
    );
  });

  it('throws when the file parses to null', () => {
    const nullPath = join(schemaTmpDir, 'null.json');
    writeFileSync(nullPath, 'null');
    expect(() => loadSchemaFile(nullPath)).toThrow(
      'Output schema must be a JSON object: ' + nullPath,
    );
  });

  it('returns the parsed object for a valid schema file', () => {
    const goodPath = join(schemaTmpDir, 'good.json');
    const schemaObj = { type: 'object', properties: { x: { type: 'string' } } };
    writeFileSync(goodPath, JSON.stringify(schemaObj));
    const result = loadSchemaFile(goodPath);
    expect(result).toEqual(schemaObj);
  });
});

describe('toGeminiSchema conversions', () => {

  it('converts a lowercase object schema to uppercase OBJECT types', () => {
    const src = {
      type: 'object',
      properties: { name: { type: 'string' }, count: { type: 'integer' } },
      required: ['name'],
    };
    const gemini = toGeminiSchema(src);
    expect(gemini.type).toBe('OBJECT');
    expect(gemini.properties!.name.type).toBe('STRING');
    expect(gemini.properties!.count.type).toBe('INTEGER');
    expect(gemini.required).toEqual(['name']);
  });

  it('accepts already-uppercase types unchanged', () => {
    const src = {
      type: 'OBJECT',
      properties: { name: { type: 'STRING' } },
    };
    const gemini = toGeminiSchema(src);
    expect(gemini.type).toBe('OBJECT');
    expect(gemini.properties!.name.type).toBe('STRING');
  });

  it('infers OBJECT from properties when type is absent', () => {
    const src = { properties: { foo: { type: 'string' } } };
    const gemini = toGeminiSchema(src);
    expect(gemini.type).toBe('OBJECT');
  });

  it('infers ARRAY from items when type is absent', () => {
    const src = { items: { type: 'string' } };
    const gemini = toGeminiSchema(src);
    expect(gemini.type).toBe('ARRAY');
  });

  it('maps a ["string","null"] union to STRING with nullable', () => {
    const src = { type: ['string', 'null'] };
    const gemini = toGeminiSchema(src);
    expect(gemini.type).toBe('STRING');
    expect(gemini.nullable).toBe(true);
  });

  it('throws for an unsupported type like "function"', () => {
    const src = { type: 'function' };
    expect(() => toGeminiSchema(src)).toThrow(
      'Unsupported output schema type "function" at $',
    );
  });

  it('throws for an object with neither type nor properties/items', () => {
    const src = {};
    expect(() => toGeminiSchema(src)).toThrow('Output schema at $ is missing "type"');
  });

  it('interpolates pointer in error messages for nested schemas', () => {
    const src = {
      type: 'object',
      properties: { items: { type: 'bogus' } },
    };
    expect(() => toGeminiSchema(src)).toThrow(
      'Unsupported output schema type "bogus" at $.items',
    );
  });

  it('interpolates pointer for array items', () => {
    const src = {
      type: 'array',
      items: { type: 'bogus' },
    };
    expect(() => toGeminiSchema(src)).toThrow(
      'Unsupported output schema type "bogus" at $[]',
    );
  });

  it('carries through description, enum, and required', () => {
    const src = {
      type: 'string',
      description: 'A value',
      enum: ['a', 'b', 'c'],
      required: ['x'],
    };
    const gemini = toGeminiSchema(src);
    expect(gemini.description).toBe('A value');
    expect(gemini.enum).toEqual(['a', 'b', 'c']);
    // required on a leaf type is carried through but unused by validation
    expect(gemini.required).toEqual(['x']);
  });

  it('ignores unknown keywords like $schema and additionalProperties', () => {
    const src = {
      type: 'object',
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      additionalProperties: false,
      minLength: 3,
      properties: { x: { type: 'string' } },
    };
    const gemini = toGeminiSchema(src);
    expect((gemini as Record<string, unknown>).$schema).toBeUndefined();
    expect((gemini as Record<string, unknown>).additionalProperties).toBeUndefined();
    expect((gemini as Record<string, unknown>).minLength).toBeUndefined();
  });
});

let configTmpDir: string;
afterAll(async () => {
  if (configTmpDir) {
    await rm(configTmpDir, { recursive: true, force: true });
  }
});

describe('loadConfig outputSchema resolution', () => {
  beforeAll(async () => {
    configTmpDir = await mkdtemp(join(tmpdir(), 'agy-config-test-'));
  });

  it('resolves a relative path to an absolute path against cwd', () => {
    const schemaPath = join(configTmpDir, 'schema.json');
    writeFileSync(schemaPath, JSON.stringify({ type: 'object' }));
    const config = loadConfig({ cwd: configTmpDir, outputSchema: 'schema.json' });
    expect(config.outputSchema).toBe(schemaPath);
  });

  it('passes through an already-absolute existing path unchanged', () => {
    const schemaPath = join(configTmpDir, 'abs.json');
    writeFileSync(schemaPath, JSON.stringify({ type: 'object' }));
    const config = loadConfig({ cwd: '/tmp', outputSchema: schemaPath });
    expect(config.outputSchema).toBe(schemaPath);
  });

  it('returns undefined when outputSchema override is absent', () => {
    const config = loadConfig({ cwd: configTmpDir });
    expect(config.outputSchema).toBe(undefined);
  });

  it('throws when the resolved schema file does not exist', () => {
    const configFn = () =>
      loadConfig({ cwd: configTmpDir, outputSchema: 'missing.json' });
    expect(configFn).toThrow(
      'Output schema file not found: ' + join(configTmpDir, 'missing.json'),
    );
  });
});
