/**
 * Codex CLI Runner
 * 通过 codex CLI 执行命令
 */
import type { CliRunOptions, CliRunSession, CliRunner } from "./cli-runner.ts";

export class CodexCliRunner implements CliRunner {
  readonly name = "codex";

  async checkInstalled(): Promise<boolean> {
    try {
      const proc = Bun.spawn(["codex", "--version"], {
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

    // 使用 -q 快速模式（非交互）
    // Codex 的 -q 会将 prompt 作为参数，而不是从 stdin 读取
    if (options.prompt) {
      args.push("-q", options.prompt);
    }

    // 危险模式：--full-auto 自动批准所有操作
    if (options.mode === "dangerous") {
      args.push("--full-auto");
    }

    // 注意：Codex 可能没有直接的 resume 机制
    // 它可能依赖 OpenAI 的 thread 管理

    const proc = Bun.spawn({
      cmd: ["codex", ...args],
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

  async probeSlashCommands(_workspacePath: string): Promise<string[]> {
    // Codex 目前没有 slash commands 概念
    // 返回空数组
    return [];
  }
}
