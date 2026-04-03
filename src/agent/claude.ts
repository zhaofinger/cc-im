import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  query,
  type PermissionResult,
  type SDKAssistantMessage,
  type SDKMessage,
  type SDKPartialAssistantMessage,
  type SDKSystemMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { AppConfig } from "../config.ts";
import { withClaudeEnv } from "../claude-env.ts";
import type { Logger } from "../logger.ts";
import type { ClaudeEvent } from "../types.ts";
import type { AgentAdapter, CommandProbe } from "./types.ts";

type ClaudeAdapterOptions = {
  config: AppConfig;
  model?: string;
  permissionMode: string;
  logger: Logger;
};

export class ClaudeAdapter implements AgentAdapter {
  constructor(private readonly options: ClaudeAdapterOptions) {}

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
    requestApproval?: (request: { approvalId: string; summary: string }) => Promise<"approve" | "reject">;
    onEvent: (event: ClaudeEvent) => Promise<void> | void;
  }): Promise<{ sessionId: string; stop: () => void }> {
    const isResume = Boolean(options.sessionId);
    const sessionId = options.sessionId || randomUUID();
    const debugFile = resolve(
      this.options.config.logDir,
      `${options.runId}.claude-debug.log`,
    );
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
          message: error instanceof Error ? error.message : String(error),
          debugFile,
        });
        if (finished) {
          return;
        }
        finished = true;
        await options.onEvent({
          type: "run_failed",
          message: error instanceof Error ? error.message : String(error),
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

  private async handleSdkMessage(
    runId: string,
    fallbackSessionId: string,
    message: SDKMessage,
    onEvent: (event: ClaudeEvent) => Promise<void> | void,
  ): Promise<void> {
    this.options.logger.run(runId, "claude sdk event", {
      type: message.type,
      subtype: "subtype" in message ? message.subtype : undefined,
    });

    if (message.type === "system" && message.subtype === "init") {
      const init = message as SDKSystemMessage;
      await onEvent({
        type: "commands",
        commands: init.slash_commands || [],
      });
      await onEvent({
        type: "status",
        message: `Claude session ready: ${init.session_id}`,
      });
      return;
    }

    if (message.type === "stream_event") {
      const partial = message as SDKPartialAssistantMessage;
      const text = this.extractStreamText(partial);
      if (text) {
        await onEvent({
          type: "assistant_text",
          text,
          partial: true,
        });
      } else {
        const thinking = this.extractThinkingState(partial);
        if (thinking) {
          await onEvent({
            type: "status",
            message: thinking,
          });
        }
      }
      return;
    }

    if (message.type === "assistant") {
      const assistant = message as SDKAssistantMessage;
      const text = assistant.message.content
        .filter((item) => item.type === "text")
        .map((item) => ("text" in item ? item.text : ""))
        .join("");
      if (text) {
        await onEvent({
          type: "assistant_text",
          text,
        });
      }
      return;
    }

    if (message.type === "tool_use_summary") {
      await onEvent({
        type: "status",
        message: `Tool result: ${message.summary}`,
      });
      return;
    }

    if (message.type === "tool_progress") {
      await onEvent({
        type: "status",
        message: `Tool: ${message.tool_name} (${Math.floor(message.elapsed_time_seconds)}s)`,
      });
      return;
    }

    if (message.type === "system" && message.subtype === "local_command_output") {
      await onEvent({
        type: "status",
        message: `Command output: ${message.content.slice(0, 240)}`,
      });
      return;
    }

    if (message.type === "system" && message.subtype === "status") {
      await onEvent({
        type: "status",
        message: `Claude status: ${message.status || "idle"}`,
      });
      return;
    }

    if (message.type === "result") {
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
      } else {
        await onEvent({
          type: "run_completed",
          sessionId: message.session_id || fallbackSessionId,
        });
      }
    }
  }

  private extractStreamText(message: SDKPartialAssistantMessage): string | undefined {
    if (message.event.type !== "content_block_delta") {
      return undefined;
    }
    const delta = message.event.delta as { type?: string; text?: string };
    if (delta.type === "text_delta" && typeof delta.text === "string") {
      return delta.text;
    }
    return undefined;
  }

  private extractThinkingState(message: SDKPartialAssistantMessage): string | undefined {
    if (message.event.type !== "content_block_delta") {
      return undefined;
    }
    const delta = message.event.delta as { type?: string };
    if (delta.type === "thinking_delta") {
      return "Thinking...";
    }
    return undefined;
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
