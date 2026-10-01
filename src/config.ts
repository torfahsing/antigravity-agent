import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface AgentConfig {
  apiKey: string;
  model: string;
  systemPrompt: string;
  maxSteps: number;
  maxCost?: number;
  allowedTools?: string[];
  outputSchema?: string;
  outputMode: 'text' | 'json' | 'quiet';
  cwd: string;
  sessionId?: string;
}

const DEFAULT_SYSTEM_PROMPT = [
  'You are a senior software engineering agent working in a local repository.',
  'Current working directory: {cwd}',
  '',
  'Guidelines:',
  '- Use your tools proactively to inspect files, search code, and execute bash commands.',
  '- Verify facts by reading code rather than guessing.',
  '- When editing files, make minimal targeted edits that adhere to the existing style.',
  '- Report concise, clear results.',
].join('\n');

export function loadConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  const apiKey = overrides.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
  const model = overrides.model || process.env.GEMINI_MODEL || process.env.AGENT_MODEL || 'gemini-3.8-flash-low';
  const cwd = overrides.cwd || process.cwd();
  const outputSchema = overrides.outputSchema
    ? resolve(cwd, overrides.outputSchema)
    : undefined;
  if (outputSchema && !existsSync(outputSchema)) {
    throw new Error(`Output schema file not found: ${outputSchema}`);
  }

  return {
    apiKey,
    model,
    systemPrompt: (overrides.systemPrompt || DEFAULT_SYSTEM_PROMPT).replace('{cwd}', cwd),
    maxSteps: overrides.maxSteps || 40,
    maxCost: overrides.maxCost,
    allowedTools: overrides.allowedTools,
    outputSchema,
    outputMode: overrides.outputMode || 'text',
    cwd,
    sessionId: overrides.sessionId,
  };
}
