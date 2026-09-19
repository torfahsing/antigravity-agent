import { spawnSync } from 'node:child_process';

export interface UsageBucket {
  name: string;
  quota_remaining: number;
  quota_limit: number;
  remaining_fraction: number;
  reset_time?: string;
}

export interface UsageResult {
  models: UsageBucket[];
}

export function parseAgyUsageJson(rawJson: string): UsageResult {
  try {
    const parsed = JSON.parse(rawJson);
    const groups = parsed?.command?.data?.groups;
    if (!Array.isArray(groups)) return { models: [] };

    const models: UsageBucket[] = [];
    for (const group of groups) {
      const groupName = group.name || 'Models';
      const buckets = group.buckets;
      if (!Array.isArray(buckets)) continue;

      for (const bucket of buckets) {
        const windowLabel = bucket.window === '5h'
          ? '5-Hour Limit'
          : bucket.window === 'weekly'
          ? 'Weekly Limit'
          : bucket.name;
        const name = `${groupName} (${windowLabel})`;
        const frac = typeof bucket.remaining_fraction === 'number'
          ? Math.max(0, Math.min(1, bucket.remaining_fraction))
          : 0;

        models.push({
          name,
          quota_remaining: 0,
          quota_limit: 0,
          remaining_fraction: frac,
          ...(bucket.reset_time ? { reset_time: String(bucket.reset_time) } : {}),
        });
      }
    }
    return { models };
  } catch {
    return { models: [] };
  }
}

export function getAgyUsage(): UsageResult {
  try {
    const res = spawnSync('agy', ['-p', '/usage', '--output-format', 'json'], {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (res.status === 0 && res.stdout) {
      return parseAgyUsageJson(res.stdout);
    }
  } catch {
    // agy not available
  }
  return { models: [] };
}
