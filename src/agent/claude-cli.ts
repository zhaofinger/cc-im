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
    const args: string[] = [];

    // 危险模式：自动批准所有操作
    // 注意：--dangerously-skip-permissions 是正确参数名
    if (options.mode === "dangerous") {
      args.push("--dangerously-skip-permissions");
    }

    // 使用 -p 非交互模式
    args.push("-p");
    args.push(options.prompt);

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
        cmd: ["claude", "-p", "List all available slash commands"],
        cwd: workspacePath,
        env: process.env,
        stdout: "pipe",
        stderr: "pipe",
      });

      const output = await new Response(proc.stdout).text();
      await proc.exited;

      // 解析输出中的 slash commands
      // 注意：实际输出格式可能因 claude 版本而异
      const commands: string[] = [];
      const lines = output.split("\n");

      for (const line of lines) {
        const trimmed = line.trim();
        // 检测常见的 slash command 格式
        const match = trimmed.match(/^\/(\w+)/);
        if (match && !commands.includes(match[1])) {
          commands.push(match[1]);
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
