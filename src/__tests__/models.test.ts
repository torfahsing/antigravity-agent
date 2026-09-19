import { describe, it, expect } from 'bun:test';
import { getAgyModels } from '../models.js';

describe('getAgyModels', () => {
  it('returns models array when agy is available', () => {
    const models = getAgyModels();
    expect(Array.isArray(models)).toBe(true);
    if (models.length > 0) {
      expect(models[0]).toHaveProperty('id');
      expect(models[0]).toHaveProperty('name');
      expect(models[0]).toHaveProperty('context_length');
      expect(models[0].is_free).toBe(true);
    }
  });
});
