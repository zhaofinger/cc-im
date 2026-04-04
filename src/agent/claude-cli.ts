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
    const args = ["-p", options.prompt];

    // 危险模式：自动批准所有操作
    if (options.mode === "dangerous") {
      args.push("--dangerous");
    }

    // 会话恢复
    if (options.sessionId) {
      args.push("--resume", options.sessionId);
    }

    const proc = Bun.spawn({
      cmd: ["claude", ...args],
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdout: "pipe",
      stderr: "pipe",
    });

    return {
      stdout: proc.stdout,
      stderr: proc.stderr,
      kill: () => {
        proc.kill();
      },
      exited: proc.exited,
    };
  }

  async probeSlashCommands(workspacePath: string): Promise<string[]> {
    try {
      const proc = Bun.spawn({
        cmd: ["claude", "-p", "/help"],
        cwd: workspacePath,
        env: process.env,
        stdout: "pipe",
        stderr: "pipe",
      });

      const output = await new Response(proc.stdout).text();
      await proc.exited;

      // 解析输出中的 slash commands
      // 典型格式：
      // Available slash commands:
      //   /commit - Commit changes
      //   /status - Show status
      const commands: string[] = [];
      const lines = output.split("\n");
      let inCommandSection = false;

      for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed.includes("slash commands") || trimmed.includes("Available commands")) {
          inCommandSection = true;
          continue;
        }

        if (inCommandSection && trimmed.startsWith("/")) {
          // 提取命令名（/command - description 或 /command）
          const match = trimmed.match(/^\/([a-zA-Z0-9_-]+)/);
          if (match) {
            commands.push(match[1]);
          }
        }

        // 遇到空行或其他章节，结束命令区域
        if (inCommandSection && trimmed === "") {
          inCommandSection = false;
        }
      }

      return commands;
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
