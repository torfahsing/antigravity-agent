import { describe, it, expect } from 'bun:test';
import { parseAgyUsageJson } from '../usage.js';

describe('parseAgyUsageJson', () => {
  it('parses valid agy usage json output', () => {
    const raw = JSON.stringify({
      status: 'SUCCESS',
      command: {
        name: 'usage',
        data: {
          groups: [
            {
              name: 'Gemini Models',
              buckets: [
                {
                  id: 'gemini-weekly',
                  name: 'Weekly Limit Remaining',
                  window: 'weekly',
                  remaining_fraction: 0.412,
                  reset_time: '2026-09-23T17:08:48Z',
                },
                {
                  id: 'gemini-5h',
                  name: 'Five Hour Limit Remaining',
                  window: '5h',
                  remaining_fraction: 0.292,
                  reset_time: '2026-09-19T21:55:46Z',
                },
              ],
            },
            {
              name: 'Claude and GPT models',
              buckets: [
                {
                  id: '3p-weekly',
                  name: 'Weekly Limit Remaining',
                  window: 'weekly',
                  remaining_fraction: 1.0,
                  reset_time: '2026-09-26T21:22:13Z',
                },
              ],
            },
          ],
        },
      },
    });

    const result = parseAgyUsageJson(raw);
    expect(result.models).toHaveLength(3);
    expect(result.models[0].name).toBe('Gemini Models (Weekly Limit)');
    expect(result.models[0].remaining_fraction).toBe(0.412);
    expect(result.models[0].reset_time).toBe('2026-09-23T17:08:48Z');

    expect(result.models[1].name).toBe('Gemini Models (5-Hour Limit)');
    expect(result.models[1].remaining_fraction).toBe(0.292);
    expect(result.models[1].reset_time).toBe('2026-09-19T21:55:46Z');

    expect(result.models[2].name).toBe('Claude and GPT models (Weekly Limit)');
    expect(result.models[2].remaining_fraction).toBe(1.0);
  });

  it('returns empty array on invalid JSON', () => {
    expect(parseAgyUsageJson('invalid json').models).toEqual([]);
    expect(parseAgyUsageJson('{}').models).toEqual([]);
    expect(parseAgyUsageJson(JSON.stringify({ command: {} })).models).toEqual([]);
  });

  it('clamps fractions to 0-1', () => {
    const raw = JSON.stringify({
      command: {
        data: {
          groups: [
            {
              name: 'Test',
              buckets: [
                { name: 'Over', window: '5h', remaining_fraction: 1.5 },
                { name: 'Under', window: 'weekly', remaining_fraction: -0.2 },
              ],
            },
          ],
        },
      },
    });
    const result = parseAgyUsageJson(raw);
    expect(result.models[0].remaining_fraction).toBe(1);
    expect(result.models[1].remaining_fraction).toBe(0);
  });
});
