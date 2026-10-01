import { describe, it, expect } from 'bun:test';
import { toGeminiSchema, validateAgainstSchema, validateSchemaOutput } from '../schema.js';

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
});
