import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import type { AppConfig } from "../config.ts";

describe("loadConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear relevant env vars before each test
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.WORKSPACE_ROOT;
    delete process.env.TELEGRAM_ALLOWED_CHAT_ID;
    delete process.env.CLAUDE_PERMISSION_MODE;
    delete process.env.CLAUDE_COMMANDS_PAGE_SIZE;
    delete process.env.LOG_DIR;
    delete process.env.AGENT_PROVIDER;
  });

  afterEach(() => {
    // Restore original env
    Object.assign(process.env, originalEnv);
  });

  test("should throw error when TELEGRAM_BOT_TOKEN is missing", async () => {
    const { loadConfig } = await import("../config.ts");
    expect(() => loadConfig()).toThrow("Missing required env var: TELEGRAM_BOT_TOKEN");
  });

  test("should load minimal config with only TELEGRAM_BOT_TOKEN", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    const { loadConfig } = await import("../config.ts");
    const config: AppConfig = loadConfig();

    expect(config.telegramBotToken).toBe("test-token");
    expect(config.workspaceRoot).toBe("/code_workspace");
    expect(config.logDir).toBe("./logs");
    expect(config.agentProvider).toBe("claude");
    expect(config.claudePermissionMode).toBe("default");
    expect(config.claudeCommandsPageSize).toBe(8);
    expect(config.telegramAllowedChatId).toBeUndefined();
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
    process.env.WORKSPACE_ROOT = "/custom/workspace";
    const { loadConfig } = await import("../config.ts");
    const config: AppConfig = loadConfig();

    expect(config.workspaceRoot).toBe("/custom/workspace");
  });

  test("should use custom LOG_DIR", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.LOG_DIR = "/custom/logs";
    const { loadConfig } = await import("../config.ts");
    const config: AppConfig = loadConfig();

    expect(config.logDir).toBe("/custom/logs");
  });

  test("should use custom AGENT_PROVIDER", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.AGENT_PROVIDER = "codex";
    const { loadConfig } = await import("../config.ts");
    const config: AppConfig = loadConfig();

    expect(config.agentProvider).toBe("codex");
  });

  test("should throw error when AGENT_PROVIDER is invalid", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.AGENT_PROVIDER = "invalid";
    const { loadConfig } = await import("../config.ts");
    expect(() => loadConfig()).toThrow("AGENT_PROVIDER must be 'claude' or 'codex'");
  });

  test("should use custom CLAUDE_PERMISSION_MODE", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.CLAUDE_PERMISSION_MODE = "dangerous";
    const { loadConfig } = await import("../config.ts");
    const config: AppConfig = loadConfig();

    expect(config.claudePermissionMode).toBe("dangerous");
  });

  test("should throw error when CLAUDE_PERMISSION_MODE is invalid", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.CLAUDE_PERMISSION_MODE = "invalid";
    const { loadConfig } = await import("../config.ts");
    expect(() => loadConfig()).toThrow("CLAUDE_PERMISSION_MODE must be 'default' or 'dangerous'");
  });

  test("should parse CLAUDE_COMMANDS_PAGE_SIZE as number", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.CLAUDE_COMMANDS_PAGE_SIZE = "12";
    const { loadConfig } = await import("../config.ts");
    const config: AppConfig = loadConfig();

    expect(config.claudeCommandsPageSize).toBe(12);
  });

  test("should handle zero as CLAUDE_COMMANDS_PAGE_SIZE", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
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
});
