export type AppMessage = {
  chatId: number;
  messageId: number;
  updateId: number;
  text?: string;
  attachments?: MessageAttachment[];
};

export type ImageAttachment = {
  kind: "image";
  localPath: string;
  originalFileName?: string;
  mimeType: string;
  width?: number;
  height?: number;
  fileSize?: number;
  caption?: string;
  sourceMessageId: number;
};

export type MessageAttachment = ImageAttachment;

export type UserMessageInput = {
  text?: string;
  attachments?: MessageAttachment[];
};

export type AppCallback = {
  id: string;
  chatId: number;
  messageId?: number;
  data: string;
};

export type PermissionMode =
  | "default"
  | "acceptEdits"
  | "plan"
  | "bypassPermissions"
  | "auto"
  | "dontAsk";

export type ChatStateStatus = "idle" | "running" | "awaiting_approval" | "awaiting_input_edit";

export type ChatState = {
  chatId: number;
  selectedWorkspace?: string;
  selectedWorkspaceName?: string;
  activeRunId?: string;
  status: ChatStateStatus;
  permissionMode: PermissionMode;
  pendingApproval?: PendingApproval;
  pendingInputEdit?: PendingInputEdit;
  messageQueue: UserMessageInput[];
};

export type PersistedChatSelection = {
  chatId: number;
  selectedWorkspace?: string;
  selectedWorkspaceName?: string;
  permissionMode?: PermissionMode;
};

export type WorkspaceSession = {
  workspacePath: string;
  workspaceName: string;
  sessionId: string;
  slashCommands: string[];
  lastTouchedAt: number;
};

export type ApprovalRequest = {
  approvalId: string;
  toolName: string;
  toolUseId?: string;
  input: Record<string, unknown>;
  description?: string;
  blockedPath?: string;
  permissionSuggestions?: string[];
};

export type PendingApproval = {
  id: string;
  runId: string;
  request: ApprovalRequest;
  createdAt: number;
  timeoutId?: Timer;
  resolve?: (decision: ApprovalDecision) => void;
};

export type PendingInputEdit = {
  approvalId: string;
  promptMessageId: number;
};

export type ApprovalDecision =
  | { type: "approve" }
  | { type: "reject"; message?: string }
  | { type: "edit"; updatedInput: Record<string, unknown> };

export type ApprovalCancelledEvent = {
  type: "approval_cancelled";
  approvalId: string;
};

export type ApprovalRequestedEvent = {
  type: "approval_requested";
  request: ApprovalRequest;
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
  | ApprovalRequestedEvent
  | ApprovalCancelledEvent
  | {
      type: "run_completed";
      sessionId: string;
    }
  | {
      type: "run_failed";
      message: string;
    };
