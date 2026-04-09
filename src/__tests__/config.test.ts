import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import type { AppConfig } from "../config.ts";

describe("loadConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear relevant env vars before each test
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.WORKSPACE_ROOT;
    delete process.env.TELEGRAM_ALLOWED_CHAT_ID;
    delete process.env.CLAUDE_COMMANDS_PAGE_SIZE;
    delete process.env.LOG_DIR;
    delete process.env.AGENT_PROVIDER;
    delete process.env.CLAUDE_APPROVAL_TIMEOUT_MS;
    delete process.env.CLAUDE_INPUT_EDIT_TIMEOUT_MS;
    delete process.env.CLAUDE_DEFAULT_PERMISSION_MODE;
    delete process.env.TELEGRAM_PROGRESS_DEBOUNCE_MS;
    delete process.env.TELEGRAM_PROGRESS_MIN_INTERVAL_MS;
  });

  afterEach(() => {
    // Restore original env
    Object.assign(process.env, originalEnv);
  });

  test("should throw error when TELEGRAM_BOT_TOKEN is missing", async () => {
    const { loadConfig } = await import("../config.ts");
    expect(() => loadConfig()).toThrow("Missing required env var: TELEGRAM_BOT_TOKEN");
  });

  test("should throw error when TELEGRAM_ALLOWED_CHAT_ID is missing", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    const { loadConfig } = await import("../config.ts");
    expect(() => loadConfig()).toThrow("Missing required env var: TELEGRAM_ALLOWED_CHAT_ID");
  });

  test("should load config with required vars", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_ALLOWED_CHAT_ID = "123456789";
    const { loadConfig } = await import("../config.ts");
    const config: AppConfig = loadConfig();

    expect(config.telegramBotToken).toBe("test-token");
    expect(config.telegramAllowedChatId).toBe(123456789);
    expect(config.workspaceRoot).toBe("/code_workspace");
    expect(config.logDir).toBe("./cc_im_logs");
    expect(config.agentProvider).toBe("claude");
    expect(config.claudeCommandsPageSize).toBe(8);
    expect(config.claudeApprovalTimeoutMs).toBe(300000);
    expect(config.claudeInputEditTimeoutMs).toBe(300000);
    expect(config.claudeDefaultPermissionMode).toBe("default");
    expect(config.telegramProgressDebounceMs).toBe(1000);
    expect(config.telegramProgressMinIntervalMs).toBe(2000);
  });

  test("should parse TELEGRAM_ALLOWED_CHAT_ID as number", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_ALLOWED_CHAT_ID = "123456789";
    const { loadConfig } = await import("../config.ts");
    const config: AppConfig = loadConfig();

    expect(config.telegramAllowedChatId).toBe(123456789);
  });

  test("should throw error when TELEGRAM_ALLOWED_CHAT_ID is not a number", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_ALLOWED_CHAT_ID = "not-a-number";
    const { loadConfig } = await import("../config.ts");
    expect(() => loadConfig()).toThrow("TELEGRAM_ALLOWED_CHAT_ID must be a number");
  });

  test("should use custom WORKSPACE_ROOT", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_ALLOWED_CHAT_ID = "123456789";
    process.env.WORKSPACE_ROOT = "/custom/workspace";
    const { loadConfig } = await import("../config.ts");
    const config: AppConfig = loadConfig();

    expect(config.workspaceRoot).toBe("/custom/workspace");
  });

  test("should use custom LOG_DIR", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_ALLOWED_CHAT_ID = "123456789";
    process.env.LOG_DIR = "/custom/logs";
    const { loadConfig } = await import("../config.ts");
    const config: AppConfig = loadConfig();

    expect(config.logDir).toBe("/custom/logs");
  });

  test("should use custom AGENT_PROVIDER", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_ALLOWED_CHAT_ID = "123456789";
    process.env.AGENT_PROVIDER = "codex";
    const { loadConfig } = await import("../config.ts");
    const config: AppConfig = loadConfig();

    expect(config.agentProvider).toBe("codex");
  });

  test("should throw error when AGENT_PROVIDER is invalid", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_ALLOWED_CHAT_ID = "123456789";
    process.env.AGENT_PROVIDER = "invalid";
    const { loadConfig } = await import("../config.ts");
    expect(() => loadConfig()).toThrow("AGENT_PROVIDER must be 'claude' or 'codex'");
  });

  test("should parse CLAUDE_COMMANDS_PAGE_SIZE as number", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_ALLOWED_CHAT_ID = "123456789";
    process.env.CLAUDE_COMMANDS_PAGE_SIZE = "12";
    const { loadConfig } = await import("../config.ts");
    const config: AppConfig = loadConfig();

    expect(config.claudeCommandsPageSize).toBe(12);
  });

  test("should handle zero as CLAUDE_COMMANDS_PAGE_SIZE", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_ALLOWED_CHAT_ID = "123456789";
    process.env.CLAUDE_COMMANDS_PAGE_SIZE = "0";
    const { loadConfig } = await import("../config.ts");
    const config: AppConfig = loadConfig();

    expect(config.claudeCommandsPageSize).toBe(0);
  });

  test("should handle negative TELEGRAM_ALLOWED_CHAT_ID", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_ALLOWED_CHAT_ID = "-12345";
    const { loadConfig } = await import("../config.ts");
    const config: AppConfig = loadConfig();

    expect(config.telegramAllowedChatId).toBe(-12345);
  });

  test("should handle large TELEGRAM_ALLOWED_CHAT_ID", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_ALLOWED_CHAT_ID = "999999999999999";
    const { loadConfig } = await import("../config.ts");
    const config: AppConfig = loadConfig();

    expect(config.telegramAllowedChatId).toBe(999999999999999);
  });

  test("should load custom Claude approval settings", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_ALLOWED_CHAT_ID = "123456789";
    process.env.CLAUDE_APPROVAL_TIMEOUT_MS = "120000";
    process.env.CLAUDE_INPUT_EDIT_TIMEOUT_MS = "180000";
    process.env.CLAUDE_DEFAULT_PERMISSION_MODE = "plan";
    process.env.TELEGRAM_PROGRESS_DEBOUNCE_MS = "4500";
    process.env.TELEGRAM_PROGRESS_MIN_INTERVAL_MS = "12000";
    const { loadConfig } = await import("../config.ts");
    const config: AppConfig = loadConfig();

    expect(config.claudeApprovalTimeoutMs).toBe(120000);
    expect(config.claudeInputEditTimeoutMs).toBe(180000);
    expect(config.claudeDefaultPermissionMode).toBe("plan");
    expect(config.telegramProgressDebounceMs).toBe(4500);
    expect(config.telegramProgressMinIntervalMs).toBe(12000);
  });

  test("should accept auto and dontAsk as Claude permission modes", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_ALLOWED_CHAT_ID = "123456789";
    process.env.CLAUDE_DEFAULT_PERMISSION_MODE = "auto";
    const { loadConfig } = await import("../config.ts");
    expect(loadConfig().claudeDefaultPermissionMode).toBe("auto");

    process.env.CLAUDE_DEFAULT_PERMISSION_MODE = "dontAsk";
    expect(loadConfig().claudeDefaultPermissionMode).toBe("dontAsk");
  });
});
