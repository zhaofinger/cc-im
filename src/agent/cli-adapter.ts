import type { AppConfig } from "../config.ts";
import type { Logger } from "../logger.ts";
import type { ApprovalDecision, ApprovalRequest, ClaudeEvent, PermissionMode } from "../types.ts";
import { shorten } from "../utils/string.ts";
import { ClaudeCliRunner, type ClaudeSession } from "./claude-cli.ts";
import type { CliRunSession, CliRunner } from "./cli-runner.ts";
import { CodexCliRunner } from "./codex-cli.ts";
import type { AgentAdapter, CommandProbe } from "./types.ts";

type ClaudeStreamState = {
  toolUses: Map<string, string>;
  replayedUserMessages: string[];
  sawAssistantText: boolean;
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
    content?: string | ClaudeMessageContentBlock[];
  };
  result?: string;
  is_error?: boolean;
  error?: string;
  attempt?: number;
  max_retries?: number;
  hook_name?: string;
  output?: string;
  stderr?: string;
  request_id?: string;
  request?: {
    subtype?: string;
    tool_name?: string;
    input?: Record<string, unknown>;
    tool_use_id?: string;
    description?: string;
    blocked_path?: string;
    permission_suggestions?: string[];
  };
};

export class CliAdapter implements AgentAdapter {
  private readonly runner: CliRunner;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {
    this.runner = config.agentProvider === "codex" ? new CodexCliRunner() : new ClaudeCliRunner();
  }

  listAvailableSessions(workspacePath: string): ClaudeSession[] {
    if (this.runner instanceof ClaudeCliRunner) {
      return this.runner.listAvailableSessions(workspacePath);
    }
    return [];
  }

  async probeSlashCommands(workspacePath: string): Promise<CommandProbe> {
    const commands = await this.runner.probeSlashCommands(workspacePath);
    return { slashCommands: commands };
  }

  async sendMessage(options: {
    runId: string;
    workspacePath: string;
    sessionId?: string;
    message: string;
    mode: PermissionMode;
    requestApproval?: (request: ApprovalRequest) => Promise<ApprovalDecision>;
    onEvent: (event: ClaudeEvent) => Promise<void> | void;
  }): Promise<{ sessionId: string; stop: () => void }> {
    const existingSessionId = options.sessionId || "";
    const debugFile = `${this.config.logDir}/${options.runId}.cli-debug.log`;

    this.logger.run(options.runId, "cli query started", {
      workspacePath: options.workspacePath,
      sessionId: existingSessionId,
      provider: this.runner.name,
      mode: options.mode,
    });

    const session = this.runner.run({
      cwd: options.workspacePath,
      sessionId: existingSessionId,
      mode: options.mode,
      env: {},
      debugFile,
    });

    if (this.runner.name === "claude") {
      session.writeStdin(buildClaudeUserInput(options.message, existingSessionId));
    }

    const resolvedSessionId = await this.processOutput(
      options.runId,
      existingSessionId,
      session,
      options.requestApproval,
      options.onEvent,
    );

    return {
      sessionId: resolvedSessionId,
      stop: () => {
        this.logger.run(options.runId, "cli stop requested", {});
        if (this.runner.name === "claude") {
          session.writeStdin(buildClaudeInterrupt());
        }
        session.kill();
      },
    };
  }

  private async processOutput(
    runId: string,
    existingSessionId: string,
    session: CliRunSession,
    requestApproval: ((request: ApprovalRequest) => Promise<ApprovalDecision>) | undefined,
    onEvent: (event: ClaudeEvent) => Promise<void> | void,
  ): Promise<string> {
    const streamState = createClaudeStreamState();
    let resolvedSessionId = existingSessionId;
    const wrappedOnEvent = async (event: ClaudeEvent): Promise<void> => {
      const extractedId =
        event.type === "status" ? extractReadySessionId(event.message) : undefined;
      if (extractedId) resolvedSessionId = extractedId;
      await onEvent(event);
    };
    const stdoutTask = this.readStream(
      runId,
      session,
      session.stdout,
      wrappedOnEvent,
      false,
      streamState,
      requestApproval,
    );
    const stderrTask = this.readStream(
      runId,
      session,
      session.stderr,
      wrappedOnEvent,
      true,
      streamState,
      requestApproval,
    );

    const [exitCode] = await Promise.all([session.exited, stdoutTask, stderrTask]);
    session.closeStdin();

    this.logger.run(runId, "cli process exited", { exitCode });

    if (exitCode === 0) {
      await wrappedOnEvent({ type: "run_completed", sessionId: resolvedSessionId });
    } else {
      await wrappedOnEvent({
        type: "run_failed",
        message: `CLI exited with code ${exitCode}`,
      });
    }

    return resolvedSessionId;
  }

  private async readStream(
    runId: string,
    session: CliRunSession,
    stream: ReadableStream,
    onEvent: (event: ClaudeEvent) => Promise<void> | void,
    isError: boolean,
    streamState: ClaudeStreamState,
    requestApproval: ((request: ApprovalRequest) => Promise<ApprovalDecision>) | undefined,
  ): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          await this.processLine(
            runId,
            session,
            line,
            onEvent,
            isError,
            streamState,
            requestApproval,
          );
        }
      }
      if (buffer) {
        await this.processLine(
          runId,
          session,
          buffer,
          onEvent,
          isError,
          streamState,
          requestApproval,
        );
      }
    } catch (error) {
      this.logger.run(runId, "stream read error", { error: String(error) });
    } finally {
      reader.releaseLock();
    }
  }

  private async processLine(
    runId: string,
    session: CliRunSession,
    line: string,
    onEvent: (event: ClaudeEvent) => Promise<void> | void,
    isError: boolean,
    streamState: ClaudeStreamState,
    requestApproval: ((request: ApprovalRequest) => Promise<ApprovalDecision>) | undefined,
  ): Promise<void> {
    const cleanLine = stripAnsi(line).trim();
    if (!cleanLine) return;

    if (isError) {
      await onEvent({ type: "status", message: `stderr: ${cleanLine}` });
      return;
    }

    if (this.runner.name === "claude") {
      const parsed = tryParseClaudeStreamJsonLine(cleanLine);
      if (parsed) {
        await this.handleClaudeJsonEvent(
          runId,
          session,
          parsed,
          streamState,
          requestApproval,
          onEvent,
        );
        return;
      }
    }

    await onEvent({
      type: "assistant_text",
      text: line + "\n",
    });
  }

  private async handleClaudeJsonEvent(
    runId: string,
    session: CliRunSession,
    event: ClaudeStreamJsonEvent,
    state: ClaudeStreamState,
    requestApproval: ((request: ApprovalRequest) => Promise<ApprovalDecision>) | undefined,
    onEvent: (event: ClaudeEvent) => Promise<void> | void,
  ): Promise<void> {
    if (
      event.type === "control_request" &&
      event.request?.subtype === "can_use_tool" &&
      event.request_id
    ) {
      const request: ApprovalRequest = {
        approvalId: event.request_id,
        toolName: event.request.tool_name || "unknown",
        toolUseId: event.request.tool_use_id,
        input: event.request.input || {},
        description: event.request.description,
        blockedPath: event.request.blocked_path,
        permissionSuggestions: event.request.permission_suggestions,
      };
      await onEvent({ type: "approval_requested", request });
      const decision =
        requestApproval?.(request) ||
        Promise.resolve({
          type: "reject",
          message: "No approval handler configured",
        } satisfies ApprovalDecision);
      session.writeStdin(buildClaudeApprovalResponse(request, await decision));
      return;
    }

    if (event.type === "control_cancel_request" && event.request_id) {
      await onEvent({ type: "approval_cancelled", approvalId: event.request_id });
      return;
    }

    if (event.type === "result") {
      session.closeStdin();
    }

    for (const mapped of mapClaudeStreamJsonEvent(event, state)) {
      if (
        mapped.type === "assistant_text" &&
        state.replayedUserMessages.includes(mapped.text.trim())
      ) {
        continue;
      }
      await onEvent(mapped);
    }

    if (event.type === "user") {
      const userText = extractUserText(event);
      if (userText) {
        state.replayedUserMessages.push(userText);
        if (state.replayedUserMessages.length > 10) state.replayedUserMessages.shift();
      }
    }

    this.logger.run(runId, "stream-json event processed", {
      type: event.type,
      subtype: event.subtype,
    });
  }
}

export function createClaudeStreamState(): ClaudeStreamState {
  return {
    toolUses: new Map<string, string>(),
    replayedUserMessages: [],
    sawAssistantText: false,
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
    for (const block of contentBlocks(event.message?.content)) {
      if (block.type === "text" && block.text) {
        state.sawAssistantText = true;
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
    for (const block of contentBlocks(event.message?.content)) {
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
    if (!state.sawAssistantText && event.result.trim()) {
      mapped.push({
        type: "assistant_text",
        text: event.result,
      });
    }
    mapped.push({
      type: "status",
      message: "phase:completed",
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

function extractReadySessionId(message: string): string | undefined {
  const prefix = "Claude session ready:";
  if (!message.startsWith(prefix)) return undefined;
  const extractedId = message.slice(prefix.length).trim();
  return extractedId && extractedId !== "unknown" ? extractedId : undefined;
}

function buildClaudeUserInput(message: string, sessionId: string): string {
  return JSON.stringify({
    type: "user",
    message: { role: "user", content: message },
    parent_tool_use_id: null,
    session_id: sessionId,
  });
}

function buildClaudeInterrupt(): string {
  return JSON.stringify({
    type: "control_request",
    request_id: crypto.randomUUID(),
    request: { subtype: "interrupt" },
  });
}

function buildClaudeApprovalResponse(request: ApprovalRequest, decision: ApprovalDecision): string {
  return JSON.stringify({
    type: "control_response",
    response: {
      subtype: "success",
      request_id: request.approvalId,
      response:
        decision.type === "reject"
          ? {
              behavior: "deny",
              message: decision.message || "Rejected from Telegram",
            }
          : {
              behavior: "allow",
              updatedInput: decision.type === "edit" ? decision.updatedInput : request.input,
            },
    },
  });
}

function extractUserText(event: ClaudeStreamJsonEvent): string | undefined {
  const content = event.message?.content;
  if (typeof content === "string") {
    return content.trim();
  }
  const parts = contentBlocks(content);
  return parts
    .filter((block) => block.type === "text" && block.text)
    .map((block) => block.text || "")
    .join("\n")
    .trim();
}

function contentBlocks(
  content: string | ClaudeMessageContentBlock[] | undefined,
): ClaudeMessageContentBlock[] {
  return Array.isArray(content) ? content : [];
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

function stripAnsi(text: string): string {
  const esc = "\u001b";
  const bel = "\u0007";
  const ansiPattern = new RegExp(
    `${esc}\\[[\\d;]*[a-zA-Z]|${esc}\\][^${bel}${esc}]*(?:${bel}|${esc}\\\\)|${esc}[()[\\]{}<>=/]#\\w+|${esc}[[\\]()#;?]|[\\u0000-\\u001f\\u007f-\\u009f]`,
    "g",
  );
  return text.replace(ansiPattern, "");
}
