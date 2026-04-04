export type AppConfig = {
  telegramBotToken: string;
  telegramAllowedChatId?: number;
  workspaceRoot: string;
  logDir: string;
  /** 选择使用哪个 CLI 工具 */
  agentProvider: "claude" | "codex";
  /** 危险模式自动批准所有操作 */
  claudePermissionMode: "dangerous" | "default";
  claudeCommandsPageSize: number;
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
  const workspaceRoot = Bun.env.WORKSPACE_ROOT || "/code_workspace";
  const allowedChatId = Bun.env.TELEGRAM_ALLOWED_CHAT_ID
    ? Number(Bun.env.TELEGRAM_ALLOWED_CHAT_ID)
    : undefined;

  if (Number.isNaN(allowedChatId)) {
    throw new Error("TELEGRAM_ALLOWED_CHAT_ID must be a number");
  }

  const permissionMode = Bun.env.CLAUDE_PERMISSION_MODE || "default";
  if (permissionMode !== "default" && permissionMode !== "dangerous") {
    throw new Error("CLAUDE_PERMISSION_MODE must be 'default' or 'dangerous'");
  }

  const provider = Bun.env.AGENT_PROVIDER || "claude";
  if (provider !== "claude" && provider !== "codex") {
    throw new Error("AGENT_PROVIDER must be 'claude' or 'codex'");
  }

  return {
    telegramBotToken: token,
    telegramAllowedChatId: allowedChatId,
    workspaceRoot,
    logDir: Bun.env.LOG_DIR || "./logs",
    agentProvider: provider as "claude" | "codex",
    claudePermissionMode: permissionMode as "dangerous" | "default",
    claudeCommandsPageSize: Number(Bun.env.CLAUDE_COMMANDS_PAGE_SIZE || "8"),
  };
}
