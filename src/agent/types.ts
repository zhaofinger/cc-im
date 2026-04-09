import type { ApprovalDecision, ApprovalRequest, ClaudeEvent, PermissionMode } from "../types.ts";

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
    mode: PermissionMode;
    requestApproval?: (request: ApprovalRequest) => Promise<ApprovalDecision>;
    onEvent: (event: ClaudeEvent) => Promise<void> | void;
  }): Promise<{ sessionId: string; stop: () => void }>;
}
