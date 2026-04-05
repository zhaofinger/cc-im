export type AppMessage = {
  chatId: number;
  messageId: number;
  updateId: number;
  text: string;
};

export type AppCallback = {
  id: string;
  chatId: number;
  messageId?: number;
  data: string;
};

export type ChatStateStatus = "idle" | "running" | "awaiting_approval";

export type ChatState = {
  chatId: number;
  selectedWorkspace?: string;
  selectedWorkspaceName?: string;
  activeRunId?: string;
  status: ChatStateStatus;
  pendingApproval?: PendingApproval;
  messageQueue: string[];
};

export type PersistedChatSelection = {
  chatId: number;
  selectedWorkspace?: string;
  selectedWorkspaceName?: string;
};

export type WorkspaceSession = {
  workspacePath: string;
  workspaceName: string;
  sessionId: string;
  slashCommands: string[];
  lastTouchedAt: number;
};

export type PendingApproval = {
  id: string;
  runId: string;
  summary: string;
  createdAt: number;
  resolve?: (decision: "approve" | "reject") => void;
};

export type ClaudeEvent =
  | {
      type: "status";
      message: string;
    }
  | {
      type: "assistant_text";
      text: string;
      partial?: boolean;
    }
  | {
      type: "commands";
      commands: string[];
    }
  | {
      type: "approval_requested";
      approvalId: string;
      summary: string;
    }
  | {
      type: "run_completed";
      sessionId: string;
    }
  | {
      type: "run_failed";
      message: string;
    };
