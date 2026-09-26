import { mkdtemp, mkdir, symlink, writeFile, copyFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';

export interface AgySandbox {
  sandboxDir: string;
  env: Record<string, string>;
  cleanup: () => Promise<void>;
}

export async function setupAgySandbox(
  allowedTools: string[],
  baseHome = homedir(),
  sessionId?: string,
): Promise<AgySandbox> {
  const safeId = sessionId ? sessionId.replace(/[^a-zA-Z0-9_-]/g, '_') : null;
  const sandboxDir = safeId
    ? path.join(tmpdir(), `agy-session-${safeId}`)
    : await mkdtemp(path.join(tmpdir(), 'agy-sandbox-'));

  const geminiDir = path.join(sandboxDir, '.gemini');
  const cliDir = path.join(geminiDir, 'antigravity-cli');
  const configDir = path.join(geminiDir, 'config');

  await mkdir(cliDir, { recursive: true });
  await mkdir(configDir, { recursive: true });

  // 1. Symlink auth & state from baseHome
  const authFiles = [
    path.join(baseHome, '.gemini', 'google_accounts.json'),
    path.join(baseHome, '.gemini', 'oauth_creds.json'),
    path.join(baseHome, '.gemini', 'state.json'),
    path.join(baseHome, '.gemini', 'antigravity-cli', 'installation_id'),
    path.join(baseHome, '.gemini', 'antigravity-cli', 'jetski_state.pbtxt'),
  ];

  for (const src of authFiles) {
    if (existsSync(src)) {
      const rel = path.relative(baseHome, src);
      const dest = path.join(sandboxDir, rel);
      await mkdir(path.dirname(dest), { recursive: true });
      if (!existsSync(dest)) {
        await symlink(src, dest).catch(() => {});
      }
    }
  }

  // 2. Settings.json (isolated copy)
  const baseSettingsPath = path.join(baseHome, '.gemini', 'antigravity-cli', 'settings.json');
  const destSettingsPath = path.join(cliDir, 'settings.json');
  if (!existsSync(destSettingsPath)) {
    if (existsSync(baseSettingsPath)) {
      try {
        await copyFile(baseSettingsPath, destSettingsPath);
      } catch {
        await writeFile(destSettingsPath, JSON.stringify({ allowNonWorkspaceAccess: true }), 'utf-8');
      }
    } else {
      await writeFile(destSettingsPath, JSON.stringify({ allowNonWorkspaceAccess: true }), 'utf-8');
    }
  }

  // 3. Gate script
  const gateScriptPath = path.join(configDir, 'gate.cjs');
  const gateScript = `#!/usr/bin/env node
const fs = require('fs');

let input = '';
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const payload = JSON.parse(input);
    const toolName = payload?.toolCall?.name || '';
    const args = payload?.toolCall?.args || {};

    const allowedStr = process.env.AGY_ALLOWED_TOOLS || process.env.SPECFLOW_ALLOWED_TOOLS || '';
    const allowed = allowedStr
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean);

    // If allowed list is empty or explicitly 'none', block all tools
    if (allowed.length === 0 || allowed.includes('none')) {
      console.log(JSON.stringify({ decision: 'deny', reason: 'Role policy does not permit any tool executions' }));
      return;
    }

    const isWrite = toolName === 'write_to_file' || toolName === 'replace_file_content';
    const isRead = toolName === 'view_file' || toolName === 'read_file' || toolName === 'list_dir' || toolName === 'file_search' || toolName === 'grep_search' || toolName === 'view_file_outline';
    const isWeb = toolName === 'search_web' || toolName === 'read_url_content';
    const isShell = toolName === 'run_command';

    let permit = false;
    let reason = 'Tool "' + toolName + '" is not permitted by role permissions';

    if (isWrite) {
      if (allowed.includes('file_write') || allowed.includes('file_edit') || allowed.includes('write')) {
        permit = true;
      } else {
        reason = 'Role policy forbids file modifications';
      }
    } else if (isRead) {
      if (allowed.includes('file_read') || allowed.includes('read') || allowed.includes('grep') || allowed.includes('glob') || allowed.includes('list_dir')) {
        permit = true;
      } else {
        reason = 'Role policy forbids file/code reading';
      }
    } else if (isWeb) {
      if (allowed.includes('web_search') || allowed.includes('web_fetch') || allowed.includes('web')) {
        permit = true;
      } else {
        reason = 'Role policy forbids web search and fetching';
      }
    } else if (isShell) {
      const cmd = args.CommandLine || '';
      const shellPats = allowed.filter(t => t.startsWith('shell(') || t === 'shell' || t === 'bash');
      if (shellPats.includes('shell') || shellPats.includes('shell(*)') || shellPats.includes('bash')) {
        permit = true;
      } else {
        for (const pat of shellPats) {
          const match = pat.match(/^shell\\((.*)\\)$/);
          if (match) {
            const sub = match[1].trim();
            if (sub.endsWith('*')) {
              const prefix = sub.slice(0, -1).trim();
              if (cmd.startsWith(prefix)) { permit = true; break; }
            } else if (cmd === sub || cmd.startsWith(sub + ' ')) {
              permit = true; break;
            }
          }
        }
      }
      if (!permit) {
        reason = 'Shell command "' + cmd + '" is not permitted by role permissions';
      }
    } else if (allowed.includes(toolName.toLowerCase())) {
      permit = true;
    }

    if (permit) {
      console.log(JSON.stringify({ decision: 'allow' }));
    } else {
      console.log(JSON.stringify({ decision: 'deny', reason }));
    }
  } catch (err) {
    console.log(JSON.stringify({ decision: 'deny', reason: 'Error evaluating gate: ' + err.message }));
  }
});
`;

  await writeFile(gateScriptPath, gateScript, { mode: 0o755 });

  // 4. Register hook in hooks.json
  const hooksConfig = {
    'specflow-gate': {
      PreToolUse: [
        {
          matcher: '*',
          hooks: [
            {
              type: 'command',
              command: `node "${gateScriptPath}"`,
            },
          ],
        },
      ],
    },
  };
  await writeFile(
    path.join(configDir, 'hooks.json'),
    JSON.stringify(hooksConfig, null, 2),
    'utf-8'
  );

  const env: Record<string, string> = {
    HOME: sandboxDir,
    AGY_ROLE_ACTIVE: 'true',
    AGY_ALLOWED_TOOLS: allowedTools.join(','),
    SPECFLOW_ROLE_ACTIVE: 'true',
    SPECFLOW_ALLOWED_TOOLS: allowedTools.join(','),
  };

  return {
    sandboxDir,
    env,
    cleanup: async () => {
      if (sessionId) {
        // Persist session sandbox across requests
        return;
      }
      try {
        await rm(sandboxDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    },
  };
}
