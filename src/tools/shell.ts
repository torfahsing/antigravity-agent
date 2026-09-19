export interface ShellInput {
  command: string;
  timeout?: number;
}

export async function executeShell(input: ShellInput, cwd = process.cwd()): Promise<string> {
  const timeoutMs = (input.timeout ?? 120) * 1000;
  const shell = process.env.SHELL || '/bin/bash';

  try {
    const proc = Bun.spawn([shell, '-c', input.command], {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    let timedOut = false;
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      proc.kill(15);
    }, timeoutMs);

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    const exitCode = await proc.exited;
    clearTimeout(timeoutTimer);

    if (timedOut) {
      return JSON.stringify({
        error: `Command timed out after ${input.timeout ?? 120}s`,
        stdout,
        stderr,
        exitCode: -1,
      });
    }

    const combined = stdout + (stderr ? `\n[stderr]\n${stderr}` : '');
    return combined.trim() ? combined : `(Process completed with exit code ${exitCode})`;
  } catch (err: any) {
    return JSON.stringify({ error: `Shell execution failed: ${err.message}` });
  }
}
