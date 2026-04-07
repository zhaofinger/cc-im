export type AppConfig = {
  telegramBotToken: string;
  telegramAllowedChatId: number;
  workspaceRoot: string;
  logDir: string;
  /** 选择使用哪个 CLI 工具 */
  agentProvider: "claude" | "codex";
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

  return {
    telegramBotToken: token,
    telegramAllowedChatId: allowedChatId,
    workspaceRoot,
    logDir: Bun.env.LOG_DIR || "./cc_im_logs",
    agentProvider: provider as "claude" | "codex",
    claudeCommandsPageSize: Number(Bun.env.CLAUDE_COMMANDS_PAGE_SIZE || "8"),
  };
}
