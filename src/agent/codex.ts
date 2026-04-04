import type { AgentAdapter, CommandProbe } from "./types.ts";

export class CodexAdapter implements AgentAdapter {
  async probeSlashCommands(_workspacePath?: string): Promise<CommandProbe> {
    return { slashCommands: [] };
  }

  async sendMessage(_options: {
    runId: string;
    workspacePath: string;
    sessionId?: string;
    message: string;
    requestApproval?: (request: { approvalId: string; summary: string }) => Promise<"approve" | "reject">;
    onEvent: (event: import("../types.ts").ClaudeEvent) => void | Promise<void>;
  }): Promise<{ sessionId: string; stop: () => void }> {
    throw new Error("CodexAdapter is not implemented yet");
  }
}
