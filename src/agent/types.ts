import type { ClaudeEvent } from "../types.ts";

export type CommandProbe = {
  sessionId?: string;
  slashCommands: string[];
};

export interface AgentAdapter {
  probeSlashCommands(workspacePath: string): Promise<CommandProbe>;
  sendMessage(options: {
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
  }): Promise<{ sessionId: string; stop: () => void }>;
}
