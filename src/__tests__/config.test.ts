import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import type { AppConfig } from "../config.ts";

describe("loadConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear relevant env vars before each test
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.WORKSPACE_ROOT;
    delete process.env.TELEGRAM_ALLOWED_CHAT_ID;
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    delete process.env.CLAUDE_MODEL;
    delete process.env.CLAUDE_PERMISSION_MODE;
    delete process.env.CLAUDE_COMMANDS_PAGE_SIZE;
    delete process.env.LOG_DIR;
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
    // Need to re-import to get fresh module
    const { loadConfig } = await import("../config.ts");
    const config: AppConfig = loadConfig();

    expect(config.telegramBotToken).toBe("test-token");
    expect(config.workspaceRoot).toBe("/code_workspace");
    expect(config.logDir).toBe("./logs");
    expect(config.claudePermissionMode).toBe("default");
    expect(config.claudeCommandsPageSize).toBe(8);
    expect(config.telegramAllowedChatId).toBeUndefined();
    expect(config.anthropicBaseUrl).toBeUndefined();
    expect(config.anthropicAuthToken).toBeUndefined();
    expect(config.anthropicApiKey).toBeUndefined();
    expect(config.claudeCodeOauthToken).toBeUndefined();
    expect(config.claudeModel).toBeUndefined();
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

  test("should throw error when ANTHROPIC_AUTH_TOKEN is set without ANTHROPIC_BASE_URL", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.ANTHROPIC_AUTH_TOKEN = "auth-token";
    const { loadConfig } = await import("../config.ts");
    expect(() => loadConfig()).toThrow(
      "ANTHROPIC_BASE_URL is required when ANTHROPIC_AUTH_TOKEN is set",
    );
  });

  test("should accept ANTHROPIC_AUTH_TOKEN when ANTHROPIC_BASE_URL is provided", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.ANTHROPIC_BASE_URL = "https://custom.api.com";
    process.env.ANTHROPIC_AUTH_TOKEN = "auth-token";
    const { loadConfig } = await import("../config.ts");
    const config: AppConfig = loadConfig();

    expect(config.anthropicBaseUrl).toBe("https://custom.api.com");
    expect(config.anthropicAuthToken).toBe("auth-token");
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

  test("should use custom CLAUDE_PERMISSION_MODE", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.CLAUDE_PERMISSION_MODE = "interactive";
    const { loadConfig } = await import("../config.ts");
    const config: AppConfig = loadConfig();

    expect(config.claudePermissionMode).toBe("interactive");
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

  test("should handle empty string optional values as undefined", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.CLAUDE_MODEL = "";
    const { loadConfig } = await import("../config.ts");
    const config: AppConfig = loadConfig();

    expect(config.claudeModel).toBeUndefined();
  });

  test("should handle ANTHROPIC_API_KEY", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.ANTHROPIC_API_KEY = "api-key-123";
    const { loadConfig } = await import("../config.ts");
    const config: AppConfig = loadConfig();

    expect(config.anthropicApiKey).toBe("api-key-123");
  });

  test("should handle CLAUDE_CODE_OAUTH_TOKEN", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "oauth-token-456";
    const { loadConfig } = await import("../config.ts");
    const config: AppConfig = loadConfig();

    expect(config.claudeCodeOauthToken).toBe("oauth-token-456");
  });

  test("should handle CLAUDE_MODEL", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.CLAUDE_MODEL = "claude-sonnet-4-6";
    const { loadConfig } = await import("../config.ts");
    const config: AppConfig = loadConfig();

    expect(config.claudeModel).toBe("claude-sonnet-4-6");
  });

  test("should handle all auth options being set", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.ANTHROPIC_API_KEY = "api-key";
    process.env.ANTHROPIC_BASE_URL = "https://custom.api.com";
    process.env.ANTHROPIC_AUTH_TOKEN = "auth-token";
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "oauth-token";
    const { loadConfig } = await import("../config.ts");
    const config: AppConfig = loadConfig();

    expect(config.anthropicApiKey).toBe("api-key");
    expect(config.anthropicBaseUrl).toBe("https://custom.api.com");
    expect(config.anthropicAuthToken).toBe("auth-token");
    expect(config.claudeCodeOauthToken).toBe("oauth-token");
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
