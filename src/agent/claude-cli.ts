/**
 * Claude Code CLI Runner
 * 通过 claude CLI 执行命令
 */
import { join } from "node:path";
import type { CliRunOptions, CliRunSession, CliRunner } from "./cli-runner.ts";

export class ClaudeCliRunner implements CliRunner {
  readonly name = "claude";

  async checkInstalled(): Promise<boolean> {
    try {
      const proc = Bun.spawn(["claude", "--version"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      await proc.exited;
      return proc.exitCode === 0;
    } catch {
      return false;
    }
  }

  run(options: CliRunOptions): CliRunSession {
    const args = buildClaudeCliArgs(options);

    const proc = Bun.spawn({
      cmd: ["claude", ...args],
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    return {
      stdout: proc.stdout,
      stderr: proc.stderr,
      writeStdin: (line: string) => {
        proc.stdin.write(`${line}\n`);
      },
      closeStdin: () => {
        proc.stdin.end();
      },
      kill: () => {
        proc.kill();
      },
      exited: proc.exited,
    };
  }

  async probeSlashCommands(workspacePath: string): Promise<string[]> {
    try {
      const proc = Bun.spawn({
        cmd: [
          "claude",
          "-p",
          "--input-format",
          "stream-json",
          "--output-format",
          "stream-json",
          "--verbose",
          "--include-hook-events",
          "--replay-user-messages",
          "--permission-mode",
          "default",
        ],
        cwd: workspacePath,
        env: process.env,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "ignore",
      });

      proc.stdin.write(
        `${JSON.stringify({
          type: "user",
          message: { role: "user", content: "hello" },
          parent_tool_use_id: null,
          session_id: "",
        })}\n`,
      );
      proc.stdin.end();

      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const commands = parseSlashCommandsFromInitLine(line);
          if (commands) {
            proc.kill();
            return commands;
          }
        }
      }
      return parseSlashCommandsFromInitLine(buffer) || [];
    } catch (error) {
      console.error("Failed to probe slash commands:", error);
      return [];
    }
  }

  /**
   * 获取会话存储路径
   */
  getSessionDir(workspacePath: string): string {
    return join(workspacePath, ".claude", "sessions");
  }
}

export function buildClaudeCliArgs(options: CliRunOptions): string[] {
  const args: string[] = [];

  if (options.sessionId) {
    args.push("--resume", options.sessionId);
  }

  if (options.debugFile) {
    args.push("--debug-file", options.debugFile);
  }

  args.push("-p");
  args.push("--input-format", "stream-json");
  args.push("--output-format", "stream-json");
  args.push("--verbose");
  args.push("--include-hook-events");
  args.push("--replay-user-messages");
  args.push("--permission-mode", options.mode);

  return args;
}

export function parseSlashCommandsFromInitLine(line: string): string[] | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed) as {
      type?: string;
      subtype?: string;
      slash_commands?: string[];
    };
    if (parsed.type !== "system" || parsed.subtype !== "init" || !parsed.slash_commands) {
      return undefined;
    }
    return parsed.slash_commands.map((command) => command.replace(/^\//, ""));
  } catch {
    return undefined;
  }
}
