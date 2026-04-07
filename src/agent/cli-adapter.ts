/**
 * CLI Adapter - 统一使用 CLI 工具替代 SDK
 * 支持 Claude Code 和 Codex
 */
import type { AppConfig } from "../config.ts";
import type { Logger } from "../logger.ts";
import type { ClaudeEvent } from "../types.ts";
import { ClaudeCliRunner } from "./claude-cli.ts";
import { CodexCliRunner } from "./codex-cli.ts";
import type { CliRunner } from "./cli-runner.ts";
import type { AgentAdapter, CommandProbe } from "./types.ts";
import { shorten } from "../utils/string.ts";

type ClaudeStreamState = {
  toolUses: Map<string, string>;
};

type ClaudeMessageContentBlock = {
  type?: string;
  id?: string;
  name?: string;
  text?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string | Array<{ type?: string; text?: string }> | null;
};

type ClaudeStreamJsonEvent = {
  type?: string;
  subtype?: string;
  session_id?: string;
  slash_commands?: string[];
  message?: {
    content?: ClaudeMessageContentBlock[];
  };
  result?: string;
  is_error?: boolean;
  error?: string;
  attempt?: number;
  max_retries?: number;
  hook_name?: string;
  output?: string;
  stderr?: string;
};

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
      slashCommands: commands,
    };
  }

  async sendMessage(options: {
    runId: string;
    workspacePath: string;
    sessionId?: string;
    message: string;
    dangerouslySkipPermissions?: boolean;
    requestApproval?: (request: {
      approvalId: string;
      summary: string;
    }) => Promise<"approve" | "reject">;
    onEvent: (event: ClaudeEvent) => Promise<void> | void;
  }): Promise<{ sessionId: string; stop: () => void }> {
    const sessionId = options.sessionId || "";
    const debugFile = `${this.config.logDir}/${options.runId}.cli-debug.log`;

    // 始终使用 dangerous 模式，让审批逻辑在应用层处理
    // 避免 Claude Code 显示交互式提示导致进程挂起
    // TODO: 实现真正的交互式提示处理（stdin 交互）
    const mode: "dangerous" | "interactive" = "dangerous";

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
    const streamState = createClaudeStreamState();

    // 并行处理 stdout 和 stderr
    const stdoutTask = this.readStream(runId, session.stdout, onEvent, false, streamState);
    const stderrTask = this.readStream(runId, session.stderr, onEvent, true, streamState);

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
    streamState: ClaudeStreamState,
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
          this.processLine(runId, line, onEvent, isError, streamState);
        }
      }

      // 处理剩余的缓冲区
      if (buffer) {
        this.processLine(runId, buffer, onEvent, isError, streamState);
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
    streamState: ClaudeStreamState,
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

    if (this.runner.name === "claude") {
      const parsed = tryParseClaudeStreamJsonLine(cleanLine);
      if (parsed) {
        for (const event of mapClaudeStreamJsonEvent(parsed, streamState)) {
          void onEvent(event);
        }
        return;
      }
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

export function createClaudeStreamState(): ClaudeStreamState {
  return {
    toolUses: new Map<string, string>(),
  };
}

export function tryParseClaudeStreamJsonLine(line: string): ClaudeStreamJsonEvent | undefined {
  if (!line.startsWith("{")) {
    return undefined;
  }

  try {
    return JSON.parse(line) as ClaudeStreamJsonEvent;
  } catch {
    return undefined;
  }
}

export function mapClaudeStreamJsonEvent(
  event: ClaudeStreamJsonEvent,
  state: ClaudeStreamState,
): ClaudeEvent[] {
  const mapped: ClaudeEvent[] = [];

  if (event.type === "system") {
    if (event.subtype === "init") {
      if (event.slash_commands && event.slash_commands.length > 0) {
        mapped.push({
          type: "commands",
          commands: event.slash_commands.map((command) => command.replace(/^\//, "")),
        });
      }
      mapped.push({
        type: "status",
        message: `Claude session ready: ${event.session_id || "unknown"}`,
      });
      return mapped;
    }

    if (event.subtype === "api_retry") {
      mapped.push({
        type: "status",
        message: `Claude status: API retry ${event.attempt || 0}/${event.max_retries || 0}`,
      });
      return mapped;
    }

    if (event.subtype === "hook_response" && (event.output || event.stderr)) {
      mapped.push({
        type: "status",
        message: `Claude status: ${event.hook_name || "hook"}: ${shortenStatusText(
          event.stderr || event.output || "",
        )}`,
      });
      return mapped;
    }

    return mapped;
  }

  if (event.type === "assistant") {
    for (const block of event.message?.content || []) {
      if (block.type === "text" && block.text) {
        mapped.push({
          type: "assistant_text",
          text: block.text,
        });
        continue;
      }

      if (block.type === "tool_use" && block.id && block.name) {
        state.toolUses.set(block.id, block.name);
        mapped.push({
          type: "status",
          message: `tool:start:${block.name}|${summarizeToolInput(block.input)}`,
        });
      }
    }
    return mapped;
  }

  if (event.type === "user") {
    for (const block of event.message?.content || []) {
      if (block.type !== "tool_result" || !block.tool_use_id) {
        continue;
      }

      const toolName = state.toolUses.get(block.tool_use_id) || "unknown";
      const resultText = summarizeToolResult(block.content);
      mapped.push({
        type: "status",
        message: `tool:end:${toolName}|${resultText}`,
      });
    }
    return mapped;
  }

  if (event.type === "result" && event.result) {
    mapped.push({
      type: "status",
      message: `phase:completed`,
    });
  }

  if (event.type === "result" && event.is_error) {
    mapped.push({
      type: "status",
      message: `Claude status: ${event.error || "execution failed"}`,
    });
  }

  return mapped;
}

function summarizeToolResult(content: ClaudeMessageContentBlock["content"]): string {
  if (typeof content === "string") {
    return shortenStatusText(content);
  }

  if (Array.isArray(content)) {
    const text = content
      .filter((part) => part.type === "text" && part.text)
      .map((part) => part.text)
      .join(" ");
    return shortenStatusText(text || "done");
  }

  return "done";
}

function summarizeToolInput(input: unknown): string {
  if (!input) {
    return "";
  }

  if (typeof input === "string") {
    return shortenStatusText(input);
  }

  if (typeof input === "object") {
    const record = input as Record<string, unknown>;
    const preferred =
      firstString(record, ["command", "file_path", "path", "description", "prompt"]) ||
      JSON.stringify(input);
    return shortenStatusText(preferred);
  }

  return shortenStatusText(String(input));
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function shortenStatusText(text: string): string {
  const singleLine = text.replace(/\s+/g, " ").trim();
  if (!singleLine) {
    return "done";
  }
  return shorten(singleLine, 120);
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
