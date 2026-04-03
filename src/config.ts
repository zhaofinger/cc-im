export type AppConfig = {
  telegramBotToken: string;
  telegramAllowedChatId?: number;
  workspaceRoot: string;
  logDir: string;
  anthropicBaseUrl?: string;
  anthropicAuthToken?: string;
  anthropicApiKey?: string;
  claudeCodeOauthToken?: string;
  claudeModel?: string;
  claudePermissionMode: string;
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
  const anthropicBaseUrl = Bun.env.ANTHROPIC_BASE_URL || undefined;
  const anthropicAuthToken = Bun.env.ANTHROPIC_AUTH_TOKEN || undefined;

  if (Number.isNaN(allowedChatId)) {
    throw new Error("TELEGRAM_ALLOWED_CHAT_ID must be a number");
  }
  if (anthropicAuthToken && !anthropicBaseUrl) {
    throw new Error("ANTHROPIC_BASE_URL is required when ANTHROPIC_AUTH_TOKEN is set");
  }

  return {
    telegramBotToken: token,
    telegramAllowedChatId: allowedChatId,
    workspaceRoot,
    logDir: Bun.env.LOG_DIR || "./logs",
    anthropicBaseUrl,
    anthropicAuthToken,
    anthropicApiKey: Bun.env.ANTHROPIC_API_KEY || undefined,
    claudeCodeOauthToken: Bun.env.CLAUDE_CODE_OAUTH_TOKEN || undefined,
    claudeModel: Bun.env.CLAUDE_MODEL || undefined,
    claudePermissionMode: Bun.env.CLAUDE_PERMISSION_MODE || "default",
    claudeCommandsPageSize: Number(Bun.env.CLAUDE_COMMANDS_PAGE_SIZE || "8"),
  };
}
