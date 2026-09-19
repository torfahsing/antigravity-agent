export interface GrepInput {
  pattern: string;
  path?: string;
  caseInsensitive?: boolean;
}

export async function executeGrep(input: GrepInput, cwd = process.cwd()): Promise<string> {
  const targetPath = input.path || '.';
  const args = ['grep', '-rn', input.caseInsensitive ? '-i' : '-s', '--exclude-dir=.git', '--exclude-dir=node_modules', input.pattern, targetPath];

  try {
    const proc = Bun.spawn(args, {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    await proc.exited;

    if (!stdout.trim() && stderr.trim()) {
      return JSON.stringify({ error: stderr.trim() });
    }

    const lines = stdout.split('\n').filter(Boolean);
    if (lines.length > 100) {
      return lines.slice(0, 100).join('\n') + `\n...(${lines.length - 100} more matches truncated)`;
    }

    return stdout.trim() || 'No matches found.';
  } catch (err: any) {
    return JSON.stringify({ error: `Grep failed: ${err.message}` });
  }
}
