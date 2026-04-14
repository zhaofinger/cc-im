import { homedir } from "node:os";
import { join } from "node:path";
import type { PermissionMode } from "./types.ts";

const DEFAULT_COMMANDS_PAGE_SIZE = 8;
const DEFAULT_APPROVAL_TIMEOUT_MS = 300000;
const DEFAULT_INPUT_EDIT_TIMEOUT_MS = 300000;
const DEFAULT_PERMISSION_MODE: PermissionMode = "default";
const DEFAULT_PROGRESS_DEBOUNCE_MS = 1000;
const DEFAULT_PROGRESS_MIN_INTERVAL_MS = 2000;
const DEFAULT_LOG_DIR = join(homedir(), ".cc-im", "logs");

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

  return {
    telegramBotToken: token,
    telegramAllowedChatId: allowedChatId,
    workspaceRoot,
    logDir: DEFAULT_LOG_DIR,
    agentProvider: provider as "claude" | "codex",
    claudeCommandsPageSize: DEFAULT_COMMANDS_PAGE_SIZE,
    claudeApprovalTimeoutMs: DEFAULT_APPROVAL_TIMEOUT_MS,
    claudeInputEditTimeoutMs: DEFAULT_INPUT_EDIT_TIMEOUT_MS,
    claudeDefaultPermissionMode: DEFAULT_PERMISSION_MODE,
    telegramProgressDebounceMs: DEFAULT_PROGRESS_DEBOUNCE_MS,
    telegramProgressMinIntervalMs: DEFAULT_PROGRESS_MIN_INTERVAL_MS,
  };
}
