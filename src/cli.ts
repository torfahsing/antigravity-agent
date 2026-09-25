#!/usr/bin/env bun
import { parseArgs } from 'node:util';
import { loadConfig, type AgentConfig } from './config.js';
import { runAgent, type AgentEvent } from './agent.js';
import { ANTIGRAVITY_AGENT_CAPABILITIES } from './capabilities.js';
import { getAgyModels } from './models.js';
import { getAgyUsage } from './usage.js';

async function getStdinText(): Promise<string> {
  return new Promise((resolve, reject) => {
    let content = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', chunk => {
      content += chunk;
    });
    process.stdin.on('end', () => resolve(content));
    process.stdin.on('error', err => reject(err));
  });
}

// Preprocess argv for --allowedTools multi-value handling
const originalArgv = process.argv.slice(2);
const argv: string[] = [];
let collectingAllowedTools = false;

for (const arg of originalArgv) {
  if (arg === '--allowedTools' || arg === '--allowed-tools') {
    collectingAllowedTools = true;
    continue;
  }
  if (collectingAllowedTools) {
    if (arg.startsWith('-')) {
      collectingAllowedTools = false;
      argv.push(arg);
    } else {
      argv.push('--allowedTools', arg);
    }
  } else {
    argv.push(arg);
  }
}

const isJson = argv.includes('-j') || argv.includes('--json');

let values: Record<string, any>;
let positionals: string[];

try {
  const parsed = parseArgs({
    args: argv,
    options: {
      prompt:            { type: 'string',  short: 'p' },
      json:              { type: 'boolean', short: 'j', default: false },
      quiet:             { type: 'boolean', short: 'q', default: false },
      session:           { type: 'string',  short: 's' },
      'no-session':      { type: 'boolean', default: false },
      model:             { type: 'string',  short: 'm' },
      'max-steps':       { type: 'string' },
      'max-cost':        { type: 'string' },
      'output-schema':   { type: 'string' },
      allowedTools:      { type: 'string',  multiple: true },
      'permission-mode': { type: 'string' },
      capabilities:      { type: 'boolean', default: false },
      models:            { type: 'boolean', default: false },
      quota:             { type: 'boolean', default: false },
      usage:             { type: 'boolean', default: false },
      help:              { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
    strict: false,
  });
  values = parsed.values;
  positionals = parsed.positionals;
} catch (err: any) {
  if (isJson) {
    process.stdout.write(JSON.stringify({ type: 'error', message: err.message }) + '\n');
  } else {
    process.stderr.write(`Error: ${err.message}\n`);
  }
  process.exit(1);
}

if (values.capabilities) {
  process.stdout.write(JSON.stringify(ANTIGRAVITY_AGENT_CAPABILITIES, null, 2) + '\n');
  process.exit(0);
}

if (values.models) {
  const models = getAgyModels();
  process.stdout.write(JSON.stringify(models, null, 2) + '\n');
  process.exit(0);
}

if (values.quota || values.usage) {
  const usage = getAgyUsage();
  process.stdout.write(JSON.stringify(usage, null, 2) + '\n');
  process.exit(0);
}

if (values.help) {
  console.log(`Usage: antigravity-agent [options] [prompt]

Options:
  -p, --prompt <text>       Prompt to send to the agent
  -j, --json                Output NDJSON event stream to stdout
  -q, --quiet               No output; exit 0 on success, 1 on error
  -m, --model <model>       Model override (default: gemini-2.5-flash)
      --max-steps <n>       Maximum agent reasoning/tool turns
      --allowedTools <t...> List of permitted tools
      --capabilities        Output agent capabilities manifest and exit
      --models              Output discovered models and exit
      --quota               Output quota/usage remaining and exit
  -h, --help                Show this help message

Prompt sources (in priority order):
  1. --prompt flag
  2. Positional argument
  3. Piped stdin
`);
  process.exit(0);
}

let prompt = values.prompt ?? positionals[0];

if (!prompt && !process.stdin.isTTY) {
  prompt = await getStdinText();
  prompt = prompt.trim();
}

if (!prompt) {
  console.error('Error: no prompt provided. Use --prompt, a positional arg, or pipe to stdin.');
  process.exit(1);
}

const overrides: Partial<AgentConfig> = {};
if (values.model) overrides.model = values.model;
if (values.allowedTools) overrides.allowedTools = values.allowedTools;
if (values['max-steps']) overrides.maxSteps = parseInt(values['max-steps'], 10);
if (values.json) overrides.outputMode = 'json';
if (values.quiet) overrides.outputMode = 'quiet';

const config = loadConfig(overrides);

try {
  const result = await runAgent(config, prompt, {
    onEvent: (event: AgentEvent) => {
      if (values.json) {
        process.stdout.write(JSON.stringify(event) + '\n');
      } else if (!values.quiet) {
        if (event.type === 'text') {
          process.stdout.write(event.delta);
        } else if (event.type === 'tool_call') {
          process.stderr.write(`\n[tool] calling ${event.name}...\n`);
        }
      }
    },
  });

  if (!values.json && !values.quiet) {
    process.stdout.write('\n');
  }
} catch (err: any) {
  if (values.json) {
    process.stdout.write(JSON.stringify({ type: 'error', message: err.message }) + '\n');
  } else {
    process.stderr.write(`Error: ${err.message}\n`);
  }
  process.exit(1);
}
