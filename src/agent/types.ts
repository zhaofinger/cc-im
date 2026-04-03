import type { ClaudeEvent } from "../types.ts";

export type CommandProbe = {
  sessionId?: string;
  slashCommands: string[];
};

export type ActiveRun = {
  runId: string;
  stop: () => void;
};

export interface AgentAdapter {
  probeSlashCommands(workspacePath: string): Promise<CommandProbe>;
  sendMessage(options: {
    runId: string;
    workspacePath: string;
    sessionId?: string;
    message: string;
    requestApproval?: (request: {
      approvalId: string;
      summary: string;
    }) => Promise<"approve" | "reject">;
    onEvent: (event: ClaudeEvent) => Promise<void> | void;
  }): Promise<{ sessionId: string; stop: () => void }>;
}
