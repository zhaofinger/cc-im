import type { PermissionMode } from "./types.ts";

export type AppConfig = {
  telegramBotToken: string;
  telegramAllowedChatId: number;
  workspaceRoot: string;
  logDir: string;
  /** 选择使用哪个 CLI 工具 */
  agentProvider: "claude" | "codex";
  claudeCommandsPageSize: number;
  claudeApprovalTimeoutMs: number;
  claudeInputEditTimeoutMs: number;
  claudeDefaultPermissionMode: PermissionMode;
  telegramProgressDebounceMs: number;
  telegramProgressMinIntervalMs: number;
};

function requireEnv(name: string): string {
  const value = Bun.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export function loadConfig(): AppConfig {
  const token = requireEnv("TELEGRAM_BOT_TOKEN");
  const allowedChatIdStr = requireEnv("TELEGRAM_ALLOWED_CHAT_ID");
  const allowedChatId = Number(allowedChatIdStr);

  if (Number.isNaN(allowedChatId)) {
    throw new Error("TELEGRAM_ALLOWED_CHAT_ID must be a number");
  }

  const workspaceRoot = Bun.env.WORKSPACE_ROOT || "/code_workspace";

  const provider = Bun.env.AGENT_PROVIDER || "claude";
  if (provider !== "claude" && provider !== "codex") {
    throw new Error("AGENT_PROVIDER must be 'claude' or 'codex'");
  }

  const permissionMode = Bun.env.CLAUDE_DEFAULT_PERMISSION_MODE || "default";
  if (
    permissionMode !== "default" &&
    permissionMode !== "acceptEdits" &&
    permissionMode !== "plan" &&
    permissionMode !== "bypassPermissions" &&
    permissionMode !== "auto" &&
    permissionMode !== "dontAsk"
  ) {
    throw new Error(
      "CLAUDE_DEFAULT_PERMISSION_MODE must be one of: default, acceptEdits, plan, bypassPermissions, auto, dontAsk",
    );
  }

  return {
    telegramBotToken: token,
    telegramAllowedChatId: allowedChatId,
    workspaceRoot,
    logDir: Bun.env.LOG_DIR || "./cc_im_logs",
    agentProvider: provider as "claude" | "codex",
    claudeCommandsPageSize: Number(Bun.env.CLAUDE_COMMANDS_PAGE_SIZE || "8"),
    claudeApprovalTimeoutMs: Number(Bun.env.CLAUDE_APPROVAL_TIMEOUT_MS || "300000"),
    claudeInputEditTimeoutMs: Number(Bun.env.CLAUDE_INPUT_EDIT_TIMEOUT_MS || "300000"),
    claudeDefaultPermissionMode: permissionMode as PermissionMode,
    telegramProgressDebounceMs: Number(Bun.env.TELEGRAM_PROGRESS_DEBOUNCE_MS || "1000"),
    telegramProgressMinIntervalMs: Number(Bun.env.TELEGRAM_PROGRESS_MIN_INTERVAL_MS || "2000"),
  };
}
