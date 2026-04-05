/**
 * CLI Adapter - 统一使用 CLI 工具替代 SDK
 * 支持 Claude Code 和 Codex
 */
import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config.ts";
import type { Logger } from "../logger.ts";
import type { ClaudeEvent } from "../types.ts";
import { ClaudeCliRunner } from "./claude-cli.ts";
import { CodexCliRunner } from "./codex-cli.ts";
import type { CliRunner } from "./cli-runner.ts";
import type { AgentAdapter, CommandProbe } from "./types.ts";

export class CliAdapter implements AgentAdapter {
  private readonly runner: CliRunner;
  private readonly config: AppConfig;
  private readonly logger: Logger;

  constructor(config: AppConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
    this.runner = config.agentProvider === "codex" ? new CodexCliRunner() : new ClaudeCliRunner();
  }

  async probeSlashCommands(workspacePath: string): Promise<CommandProbe> {
    const commands = await this.runner.probeSlashCommands(workspacePath);

    return {
      sessionId: randomUUID(),
      slashCommands: commands.map((cmd) => `/${cmd}`),
    };
  }

  async sendMessage(options: {
    runId: string;
    workspacePath: string;
    sessionId?: string;
    message: string;
    requestApproval?: (request: {
      approvalId: string;
      summary: string;
    }) => Promise<"approve" | "reject">;
    onEvent: (event: ClaudeEvent) => Promise<void> | void;
  }): Promise<{ sessionId: string; stop: () => void }> {
    const sessionId = options.sessionId || randomUUID();
    const debugFile = `${this.config.logDir}/${options.runId}.cli-debug.log`;

    // 危险模式下不使用审批（简化实现）
    // 如果 requestApproval 存在，理论上应该用交互模式
    // 但为了简化，我们先统一用 dangerous 模式
    const mode: "dangerous" | "interactive" =
      this.config.claudePermissionMode === "dangerous" ? "dangerous" : "interactive";

    this.logger.run(options.runId, "cli query started", {
      workspacePath: options.workspacePath,
      sessionId,
      provider: this.runner.name,
      mode,
    });

    const session = this.runner.run({
      cwd: options.workspacePath,
      prompt: options.message,
      sessionId,
      mode,
      env: {}, // CLI 从环境变量读取配置
      debugFile,
    });

    // 启动流式处理
    this.processOutput(options.runId, sessionId, session, options.onEvent);

    return {
      sessionId,
      stop: () => {
        this.logger.run(options.runId, "cli stop requested", {});
        session.kill();
      },
    };
  }

  private async processOutput(
    runId: string,
    sessionId: string,
    session: { stdout: ReadableStream; stderr: ReadableStream; exited: Promise<number> },
    onEvent: (event: ClaudeEvent) => Promise<void> | void,
  ): Promise<void> {
    // 并行处理 stdout 和 stderr
    const stdoutTask = this.readStream(runId, session.stdout, onEvent, false);
    const stderrTask = this.readStream(runId, session.stderr, onEvent, true);

    // 等待进程结束
    const [exitCode] = await Promise.all([session.exited, stdoutTask, stderrTask]);

    this.logger.run(runId, "cli process exited", { exitCode });

    if (exitCode === 0) {
      await onEvent({ type: "run_completed", sessionId });
    } else {
      await onEvent({
        type: "run_failed",
        message: `CLI exited with code ${exitCode}`,
      });
    }
  }

  private async readStream(
    runId: string,
    stream: ReadableStream,
    onEvent: (event: ClaudeEvent) => Promise<void> | void,
    isError: boolean,
  ): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // 按行分割处理
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // 保留最后一个不完整的行

        for (const line of lines) {
          this.processLine(runId, line, onEvent, isError);
        }
      }

      // 处理剩余的缓冲区
      if (buffer) {
        this.processLine(runId, buffer, onEvent, isError);
      }
    } catch (error) {
      this.logger.run(runId, "stream read error", { error: String(error) });
    } finally {
      reader.releaseLock();
    }
  }

  private processLine(
    runId: string,
    line: string,
    onEvent: (event: ClaudeEvent) => Promise<void> | void,
    isError: boolean,
  ): void {
    // 移除 ANSI 转义序列
    const cleanLine = stripAnsi(line).trim();

    if (!cleanLine) return;

    if (isError) {
      // 错误输出作为状态事件
      void onEvent({
        type: "status",
        message: `stderr: ${cleanLine}`,
      });
      return;
    }

    // 解析关键事件模式
    // 注意：危险模式下不会显示工具调用确认提示
    // 这些模式可能因 CLI 版本而异，需要持续调整

    if (cleanLine.includes("Now let me") || cleanLine.includes("I'll")) {
      // 检测到助手开始行动
      void onEvent({
        type: "status",
        message: `phase:thinking`,
      });
    }

    if (cleanLine.startsWith("✓") || cleanLine.startsWith("✅")) {
      // 检测到完成标记
      void onEvent({
        type: "status",
        message: `phase:completed`,
      });
    }

    if (cleanLine.startsWith("▶") || cleanLine.startsWith("→")) {
      // 检测到执行标记
      void onEvent({
        type: "status",
        message: `phase:using tool`,
      });
    }

    // 所有非空行都作为 assistant 文本
    // 累积发送（带换行符）
    void onEvent({
      type: "assistant_text",
      text: line + "\n",
    });
  }
}

/**
 * 移除 ANSI 转义序列
 * 支持颜色码、光标移动、清除屏幕等多种 ANSI 序列
 */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  const ansiPattern =
    /\u001b\[[\d;]*[a-zA-Z]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[()[\]{}<>=/]#\w+|\u001b[[\]()#;?]|[\u0000-\u001f\u007f-\u009f]/g;
  return text.replace(ansiPattern, "");
}
