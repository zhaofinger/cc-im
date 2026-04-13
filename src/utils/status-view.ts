import type { ChatState, PermissionMode } from "../types.ts";

export type ActiveRunStatusView = {
  runId: string;
  phase: string;
};

export type StatusCardSections = {
  mode: string;
  state?: string;
  run?: string;
  approval?: string;
};

const PERMISSION_MODE_LABELS: Record<PermissionMode, string> = {
  acceptEdits: "⏵︎⏵︎ acceptEdits mode on",
  auto: "auto mode on",
  bypassPermissions: "⏵︎⏵︎ bypassPermissions mode on",
  default: "default mode on",
  dontAsk: "⏵︎⏵︎ dontAsk mode on",
  plan: "plan mode on",
};

const RUN_PHASE_LABELS: Record<string, string> = {
  Completed: "Completed",
  Failed: "Failed",
  Processing: "Processing",
  "Processing result": "Processing result",
  Ready: "Ready",
  Starting: "Starting",
  Thinking: "Thinking",
  "Using tool": "Using tool",
};

export function renderPermissionModeLabel(
  mode?: PermissionMode,
  fallbackMode: PermissionMode = "default",
): string {
  return PERMISSION_MODE_LABELS[mode || fallbackMode];
}

export function buildStatusCardSections(args: {
  state: ChatState;
  activeRun?: ActiveRunStatusView;
  fallbackMode?: PermissionMode;
}): StatusCardSections {
  const { state, activeRun, fallbackMode } = args;
  const statusText = buildChatStatusText(state, activeRun);

  return {
    mode: renderPermissionModeLabel(state.permissionMode, fallbackMode),
    state: statusText === "Idle" ? undefined : statusText,
    run: activeRun ? `${activeRun.runId}\n${formatRunPhase(activeRun.phase)}` : undefined,
    approval: state.pendingApproval
      ? [
          state.pendingApproval.id,
          state.pendingApproval.request.toolName
            ? `Tool: ${state.pendingApproval.request.toolName}`
            : undefined,
        ]
          .filter(Boolean)
          .join("\n")
      : undefined,
  };
}

function buildChatStatusText(state: ChatState, activeRun?: ActiveRunStatusView): string {
  if (state.pendingInputEdit) {
    return "Awaiting edited approval input";
  }

  if (state.pendingApproval) {
    const toolName = state.pendingApproval.request.toolName;
    return toolName ? `Awaiting approval for ${toolName}` : "Awaiting approval";
  }

  if (activeRun) {
    return formatRunPhase(activeRun.phase);
  }

  if (state.activeRunId) {
    return "Running";
  }

  return "Idle";
}

function formatRunPhase(phase: string): string {
  const trimmed = phase.trim();
  if (!trimmed) {
    return "Running";
  }
  return RUN_PHASE_LABELS[trimmed] || trimmed;
}
