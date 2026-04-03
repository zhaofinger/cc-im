import { randomUUID } from "node:crypto";
import {
  query,
  type PermissionResult,
  type SDKAssistantMessage,
  type SDKLocalCommandOutputMessage,
  type SDKMessage,
  type SDKPartialAssistantMessage,
  type SDKResultMessage,
  type SDKStatusMessage,
  type SDKSystemMessage,
  type SDKToolProgressMessage,
  type SDKToolUseSummaryMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { AppConfig } from "../config.ts";
import { withClaudeEnv } from "../claude-env.ts";
import type { Logger } from "../logger.ts";
import type { ClaudeEvent } from "../types.ts";
import type { AgentAdapter, CommandProbe } from "./types.ts";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type ClaudeAdapterOptions = {
  config: AppConfig;
  model?: string;
  permissionMode: string;
  logger: Logger;
};

export class ClaudeAdapter implements AgentAdapter {
  private readonly logDir: string;

  constructor(private readonly options: ClaudeAdapterOptions) {
    this.logDir = options.config.logDir;
  }

  async probeSlashCommands(workspacePath: string): Promise<CommandProbe> {
    return await withClaudeEnv(this.options.config, async () => {
      const fallbackSessionId = randomUUID();
      const session = query({
        prompt: "Reply with exactly READY.",
        options: {
          cwd: workspacePath,
          sessionId: fallbackSessionId,
          permissionMode: this.options.permissionMode as never,
          model: this.options.model,
        },
      });

      const probe: CommandProbe = {
        sessionId: fallbackSessionId,
        slashCommands: [],
      };

      try {
        for await (const message of session) {
          if (message.type === "system" && message.subtype === "init") {
            probe.sessionId = message.session_id;
            probe.slashCommands = message.slash_commands || [];
            break;
          }
        }
      } finally {
        session.close();
      }

      return probe;
    });
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
    const isResume = Boolean(options.sessionId);
    const sessionId = options.sessionId || randomUUID();
    const debugFile = `${this.logDir}/${options.runId}.claude-debug.log`;
    const approvedTools = new Set<string>();
    let stoppedByBridge = false;
    let finished = false;

    const runner = withClaudeEnv(this.options.config, async () => {
      const session = query({
        prompt: options.message,
        options: {
          cwd: options.workspacePath,
          sessionId: isResume ? undefined : sessionId,
          resume: isResume ? options.sessionId : undefined,
          permissionMode: this.options.permissionMode as never,
          model: this.options.model,
          includePartialMessages: true,
          debug: true,
          debugFile,
          stderr: (data) => {
            const trimmed = data.trim();
            if (trimmed) {
              this.options.logger.run(options.runId, "claude stderr", {
                message: trimmed,
              });
            }
          },
          canUseTool: async (toolName, input, details): Promise<PermissionResult> => {
            if (approvedTools.has(toolName)) {
              this.options.logger.run(options.runId, "claude tool auto-approved", {
                toolName,
              });
              return {
                behavior: "allow",
                updatedInput: input,
                updatedPermissions: details.suggestions,
              };
            }

            if (!options.requestApproval) {
              return {
                behavior: "deny",
                message: "Approval handler is not configured",
              };
            }

            const approvalId = randomUUID();
            const summary = this.buildApprovalSummary(toolName, input, details);
            await options.onEvent({
              type: "approval_requested",
              approvalId,
              summary,
            });
            const decision = await options.requestApproval({ approvalId, summary });
            if (decision === "approve") {
              approvedTools.add(toolName);
              return {
                behavior: "allow",
                updatedInput: input,
                updatedPermissions: details.suggestions,
              };
            }
            return {
              behavior: "deny",
              message: "User rejected this action from Telegram",
            };
          },
        },
      });

      try {
        this.options.logger.run(options.runId, "claude query started", {
          workspacePath: options.workspacePath,
          sessionId,
          debugFile,
        });
        for await (const message of session) {
          await this.handleSdkMessage(options.runId, sessionId, message, options.onEvent);
          if (message.type === "result") {
            finished = true;
          }
        }
      } finally {
        session.close();
      }
    });

    void (async () => {
      try {
        await runner;
      } catch (error) {
        this.options.logger.run(options.runId, "claude query failed", {
          message: getErrorMessage(error),
          debugFile,
        });
        if (finished) {
          return;
        }
        finished = true;
        await options.onEvent({
          type: "run_failed",
          message: getErrorMessage(error),
        });
        return;
      }

      if (finished) {
        return;
      }
      finished = true;
      if (stoppedByBridge) {
        await options.onEvent({
          type: "run_failed",
          message: "Run stopped",
        });
        return;
      }
      await options.onEvent({
        type: "run_completed",
        sessionId,
      });
    })();

    return {
      sessionId,
      stop: () => {
        stoppedByBridge = true;
      },
    };
  }

  private handleSdkMessage = async (
    runId: string,
    sessionId: string,
    message: SDKMessage,
    onEvent: (event: ClaudeEvent) => Promise<void> | void,
  ): Promise<void> => {
    this.options.logger.run(runId, "claude sdk event", {
      type: message.type,
      subtype: "subtype" in message ? message.subtype : undefined,
    });

    switch (message.type) {
      case "system":
        if (message.subtype === "init") {
          await this.handleSystemInitMessage(message, onEvent);
        } else if (message.subtype === "local_command_output") {
          await this.handleLocalCommandOutputMessage(message, onEvent);
        } else if (message.subtype === "status") {
          await this.handleStatusMessage(message, onEvent);
        }
        break;
      case "stream_event":
        await this.handleStreamEventMessage(message, onEvent);
        break;
      case "assistant":
        await this.handleAssistantMessage(message, onEvent);
        break;
      case "tool_use_summary":
        await this.handleToolUseSummaryMessage(message, onEvent);
        break;
      case "tool_progress":
        await this.handleToolProgressMessage(message, onEvent);
        break;
      case "result":
        await this.handleResultMessage(message, sessionId, onEvent);
        break;
    }
  };

  private async handleSystemInitMessage(
    message: SDKSystemMessage,
    onEvent: (event: ClaudeEvent) => Promise<void> | void,
  ): Promise<void> {
    await onEvent({
      type: "commands",
      commands: message.slash_commands,
    });
    await onEvent({
      type: "status",
      message: `Claude session ready: ${message.session_id}`,
    });
  }

  private async handleLocalCommandOutputMessage(
    message: SDKLocalCommandOutputMessage,
    onEvent: (event: ClaudeEvent) => Promise<void> | void,
  ): Promise<void> {
    await onEvent({
      type: "status",
      message: `Command output: ${message.content.slice(0, 240)}`,
    });
  }

  private async handleStatusMessage(
    message: SDKStatusMessage,
    onEvent: (event: ClaudeEvent) => Promise<void> | void,
  ): Promise<void> {
    await onEvent({
      type: "status",
      message: `Claude status: ${message.status || "idle"}`,
    });
  }

  private async handleStreamEventMessage(
    message: SDKPartialAssistantMessage,
    onEvent: (event: ClaudeEvent) => Promise<void> | void,
  ): Promise<void> {
    const text = this.extractStreamText(message);
    if (text) {
      await onEvent({
        type: "assistant_text",
        text,
        partial: true,
      });
      return;
    }

    const thinking = this.extractThinkingState(message);
    if (thinking) {
      await onEvent({
        type: "status",
        message: thinking,
      });
    }
  }

  private async handleAssistantMessage(
    message: SDKAssistantMessage,
    onEvent: (event: ClaudeEvent) => Promise<void> | void,
  ): Promise<void> {
    const text = message.message.content
      .filter((item) => item.type === "text")
      .map((item) => ("text" in item ? item.text : ""))
      .join("");
    if (text) {
      await onEvent({
        type: "assistant_text",
        text,
      });
    }
  }

  private async handleToolUseSummaryMessage(
    message: SDKToolUseSummaryMessage,
    onEvent: (event: ClaudeEvent) => Promise<void> | void,
  ): Promise<void> {
    await onEvent({
      type: "status",
      message: `tool:end:tool|${message.summary}`,
    });
  }

  private async handleToolProgressMessage(
    message: SDKToolProgressMessage,
    onEvent: (event: ClaudeEvent) => Promise<void> | void,
  ): Promise<void> {
    await onEvent({
      type: "status",
      message: `tool:start:${message.tool_name}|${Math.floor(message.elapsed_time_seconds)}`,
    });
  }

  private async handleResultMessage(
    message: SDKResultMessage,
    sessionId: string,
    onEvent: (event: ClaudeEvent) => Promise<void> | void,
  ): Promise<void> {
    if (message.subtype === "success" && message.result) {
      await onEvent({
        type: "assistant_text",
        text: message.result,
      });
    }
    if (message.subtype !== "success") {
      await onEvent({
        type: "run_failed",
        message: message.errors.join("\n") || "Claude run failed",
      });
      return;
    }

    await onEvent({
      type: "run_completed",
      sessionId: message.session_id || sessionId,
    });
  }

  private extractFromDelta<T>(
    message: SDKPartialAssistantMessage,
    extractor: (delta: unknown) => T | undefined,
  ): T | undefined {
    if (message.event.type !== "content_block_delta") {
      return undefined;
    }
    return extractor(message.event.delta);
  }

  private extractStreamText(message: SDKPartialAssistantMessage): string | undefined {
    return this.extractFromDelta(message, (delta) => {
      const d = delta as { type?: string; text?: string };
      return d.type === "text_delta" && typeof d.text === "string" ? d.text : undefined;
    });
  }

  private extractThinkingState(message: SDKPartialAssistantMessage): string | undefined {
    return this.extractFromDelta(message, (delta) => {
      const d = delta as { type?: string };
      return d.type === "thinking_delta" ? "Thinking..." : undefined;
    });
  }

  private buildApprovalSummary(
    toolName: string,
    input: Record<string, unknown>,
    details: {
      title?: string;
      description?: string;
      blockedPath?: string;
      decisionReason?: string;
    },
  ): string {
    const lines = [details.title || `Claude wants to use ${toolName}`];
    if (details.description) {
      lines.push(details.description);
    }
    if (details.blockedPath) {
      lines.push(`blockedPath: ${details.blockedPath}`);
    }
    if (details.decisionReason) {
      lines.push(`reason: ${details.decisionReason}`);
    }
    lines.push(`input: ${JSON.stringify(input)}`);
    return lines.join("\n").slice(0, 1000);
  }
}
