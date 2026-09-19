import { spawnSync } from 'node:child_process';

export interface DiscoveredModel {
  id: string;
  model_id: string;
  name: string;
  context_length: number;
  prompt_cost_per_1m: number;
  completion_cost_per_1m: number;
  is_free: boolean;
  description: string;
  category: string;
}

export function getAgyModels(): DiscoveredModel[] {
  try {
    const res = spawnSync('agy', ['models'], {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (res.status === 0 && res.stdout) {
      const lines = res.stdout.split('\n');
      const models: DiscoveredModel[] = [];
      for (const rawLine of lines) {
        const line = rawLine.replace(/\r/g, '').trim();
        if (!line || line.startsWith('Fetching')) continue;
        const parts = line.split('\t');
        const id = parts[0].trim();
        const name = parts[1]?.trim() || id;
        if (id) {
          models.push({
            id,
            model_id: id,
            name,
            context_length: 1_000_000,
            prompt_cost_per_1m: 0,
            completion_cost_per_1m: 0,
            is_free: true,
            description: name,
            category: 'programming',
          });
        }
      }
      if (models.length > 0) return models;
    }
  } catch {
    // agy not available
  }
  return [];
}
