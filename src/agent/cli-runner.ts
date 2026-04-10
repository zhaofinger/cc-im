import type { PermissionMode } from "../types.ts";

export interface CliRunOptions {
  cwd: string;
  prompt?: string;
  sessionId?: string;
  mode: PermissionMode;
  env: Record<string, string>;
  debugFile?: string;
}

export interface CliRunSession {
  stdout: ReadableStream;
  stderr: ReadableStream;
  writeStdin: (line: string) => void;
  closeStdin: () => void;
  kill: () => void;
  exited: Promise<number>;
}

export interface CliRunner {
  readonly name: string;
  checkInstalled(): Promise<boolean>;
  run(options: CliRunOptions): CliRunSession;
  probeSlashCommands(workspacePath: string): Promise<string[]>;
}

export async function checkCliInstalled(command: string): Promise<boolean> {
  try {
    const proc = Bun.spawn([command, "--version"], { stdout: "pipe", stderr: "pipe" });
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

export function createSpawnSession(
  command: string,
  args: string[],
  options: CliRunOptions,
  stdin: "pipe" | "ignore" = "pipe",
): CliRunSession {
  const proc = Bun.spawn({
    cmd: [command, ...args],
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdin,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    stdout: proc.stdout,
    stderr: proc.stderr,
    writeStdin: (line: string) => {
      if (stdin === "pipe" && proc.stdin) proc.stdin.write(`${line}\n`);
    },
    closeStdin: () => {
      if (stdin === "pipe" && proc.stdin) proc.stdin.end();
    },
    kill: () => {
      proc.kill();
    },
    exited: proc.exited,
  };
}
