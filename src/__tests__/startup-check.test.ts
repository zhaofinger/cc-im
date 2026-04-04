import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runStartupChecks } from "../startup-check.ts";
import type { AppConfig } from "../config.ts";
import type { TelegramApi } from "../telegram/api.ts";
import type { Logger } from "../logger.ts";

// Create mock implementations
function createMockConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    telegramBotToken: "test-token",
    workspaceRoot: join(tmpdir(), `startup-test-${Date.now()}`),
    logDir: join(tmpdir(), `startup-logs-${Date.now()}`),
    claudePermissionMode: "default",
    claudeCommandsPageSize: 8,
    ...overrides,
  };
}

function createMockTelegramApi(): TelegramApi {
  return {
    bot: {} as any,
    sendMessage: async () => 123,
    sendMessageDraft: async () => {},
    getMe: async () => ({ id: 12345, username: "testbot" }),
    editMessageText: async () => {},
    answerCallbackQuery: async () => {},
    sendTyping: async () => {},
    setMyCommands: async () => {},
  } as unknown as TelegramApi;
}

function createMockLogger(): Logger & {
  getLogs: () => { level: string; message: string; details?: unknown }[];
} {
  const logs: { level: string; message: string; details?: unknown }[] = [];
  return {
    info: (message: string, details?: unknown) => {
      logs.push({ level: "info", message, details });
    },
    error: (message: string, details?: unknown) => {
      logs.push({ level: "error", message, details });
    },
    run: (runId: string, message: string, details?: unknown) => {
      logs.push({ level: "run", message: `${runId}: ${message}`, details });
    },
    getLogs: () => logs,
  } as unknown as Logger & {
    getLogs: () => { level: string; message: string; details?: unknown }[];
  };
}

describe("runStartupChecks", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `startup-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  describe("telegram check", () => {
    test("should check telegram and log bot info", async () => {
      const config = createMockConfig({ workspaceRoot: testDir });
      const telegram = createMockTelegramApi();
      const logger = createMockLogger();

      await runStartupChecks({ config, telegram, logger });

      const logs = logger.getLogs();
      const telegramStartLog = logs.find((l) => l.message === "startup check: telegram");
      const telegramPassLog = logs.find((l) => l.message === "startup check passed: telegram");

      expect(telegramStartLog).toBeDefined();
      expect(telegramPassLog).toBeDefined();
      expect(telegramPassLog?.details).toEqual({ username: "testbot", id: 12345 });
    });

    test("should propagate telegram errors", async () => {
      const config = createMockConfig({ workspaceRoot: testDir });
      const telegram = createMockTelegramApi();
      telegram.getMe = async () => {
        throw new Error("Telegram API error");
      };
      const logger = createMockLogger();

      await expect(runStartupChecks({ config, telegram, logger })).rejects.toThrow(
        "Telegram API error",
      );
    });

    test("should handle telegram without username", async () => {
      const config = createMockConfig({ workspaceRoot: testDir });
      const telegram = createMockTelegramApi();
      telegram.getMe = async () => ({ id: 12345 });
      const logger = createMockLogger();

      await runStartupChecks({ config, telegram, logger });

      const logs = logger.getLogs();
      const telegramPassLog = logs.find((l) => l.message === "startup check passed: telegram");
      expect(telegramPassLog?.details).toEqual({ username: undefined, id: 12345 });
    });
  });

  describe("workspace check", () => {
    test("should check workspace root exists", async () => {
      const config = createMockConfig({ workspaceRoot: testDir });
      const telegram = createMockTelegramApi();
      const logger = createMockLogger();

      await runStartupChecks({ config, telegram, logger });

      const logs = logger.getLogs();
      const workspaceStartLog = logs.find((l) => l.message === "startup check: workspace root");
      const workspacePassLog = logs.find(
        (l) => l.message === "startup check passed: workspace root",
      );

      expect(workspaceStartLog).toBeDefined();
      expect(workspacePassLog).toBeDefined();
    });

    test("should throw if workspace root is not a directory", async () => {
      const filePath = join(testDir, "not-a-dir.txt");
      writeFileSync(filePath, "content");
      const config = createMockConfig({ workspaceRoot: filePath });
      const telegram = createMockTelegramApi();
      const logger = createMockLogger();

      await expect(runStartupChecks({ config, telegram, logger })).rejects.toThrow(
        "WORKSPACE_ROOT is not a directory",
      );
    });

    test("should throw if workspace root doesn't exist", async () => {
      const config = createMockConfig({ workspaceRoot: join(testDir, "non-existent") });
      const telegram = createMockTelegramApi();
      const logger = createMockLogger();

      await expect(runStartupChecks({ config, telegram, logger })).rejects.toThrow();
    });

    test("should detect first workspace candidate", async () => {
      mkdirSync(join(testDir, "project-a"));
      mkdirSync(join(testDir, "project-b"));

      const config = createMockConfig({ workspaceRoot: testDir });
      const telegram = createMockTelegramApi();
      const logger = createMockLogger();

      await runStartupChecks({ config, telegram, logger });

      const logs = logger.getLogs();
      const workspacePassLog = logs.find(
        (l) => l.message === "startup check passed: workspace root",
      );
      expect(workspacePassLog?.details).toHaveProperty("firstWorkspace");
      expect(workspacePassLog?.details).toHaveProperty("workspaceRoot", testDir);
    });

    test("should handle empty workspace root", async () => {
      const config = createMockConfig({ workspaceRoot: testDir });
      const telegram = createMockTelegramApi();
      const logger = createMockLogger();

      await runStartupChecks({ config, telegram, logger });

      const logs = logger.getLogs();
      const workspacePassLog = logs.find(
        (l) => l.message === "startup check passed: workspace root",
      );
      expect(workspacePassLog?.details).toHaveProperty("firstWorkspace", null);
    });

    test("should ignore special directories", async () => {
      mkdirSync(join(testDir, ".hidden"));
      mkdirSync(join(testDir, "node_modules"));
      mkdirSync(join(testDir, "logs"));
      mkdirSync(join(testDir, "valid-project"));

      const config = createMockConfig({ workspaceRoot: testDir });
      const telegram = createMockTelegramApi();
      const logger = createMockLogger();

      await runStartupChecks({ config, telegram, logger });

      const logs = logger.getLogs();
      const workspacePassLog = logs.find(
        (l) => l.message === "startup check passed: workspace root",
      );
      // Should find valid-project
      expect(workspacePassLog?.details).toHaveProperty("firstWorkspace");
      expect((workspacePassLog?.details as any).firstWorkspace).toContain("valid-project");
    });
  });

  describe("claude check", () => {
    test("should check claude configuration", async () => {
      const config = createMockConfig({
        workspaceRoot: testDir,
        anthropicApiKey: "test-api-key",
      });
      const telegram = createMockTelegramApi();
      const logger = createMockLogger();

      await runStartupChecks({ config, telegram, logger });

      const logs = logger.getLogs();
      const claudeStartLog = logs.find((l) => l.message === "startup check: claude");
      const claudePassLog = logs.find((l) => l.message === "startup check passed: claude");

      expect(claudeStartLog).toBeDefined();
      expect(claudePassLog).toBeDefined();
      expect(claudePassLog?.details).toHaveProperty("authConfigured", true);
    });

    test("should report auth not configured when no auth", async () => {
      const config = createMockConfig({ workspaceRoot: testDir });
      const telegram = createMockTelegramApi();
      const logger = createMockLogger();

      await runStartupChecks({ config, telegram, logger });

      const logs = logger.getLogs();
      const claudePassLog = logs.find((l) => l.message === "startup check passed: claude");
      expect(claudePassLog?.details).toHaveProperty("authConfigured", false);
    });

    test("should detect api-key provider", async () => {
      const config = createMockConfig({
        workspaceRoot: testDir,
        anthropicApiKey: "api-key",
      });
      const telegram = createMockTelegramApi();
      const logger = createMockLogger();

      await runStartupChecks({ config, telegram, logger });

      const logs = logger.getLogs();
      const claudePassLog = logs.find((l) => l.message === "startup check passed: claude");
      expect(claudePassLog?.details).toHaveProperty("provider", "api-key");
    });

    test("should detect oauth-token provider", async () => {
      const config = createMockConfig({
        workspaceRoot: testDir,
        claudeCodeOauthToken: "oauth-token",
      });
      const telegram = createMockTelegramApi();
      const logger = createMockLogger();

      await runStartupChecks({ config, telegram, logger });

      const logs = logger.getLogs();
      const claudePassLog = logs.find((l) => l.message === "startup check passed: claude");
      expect(claudePassLog?.details).toHaveProperty("provider", "oauth-token");
    });

    test("should detect custom-base-url provider", async () => {
      const config = createMockConfig({
        workspaceRoot: testDir,
        anthropicBaseUrl: "https://custom.api.com",
        anthropicAuthToken: "auth-token",
      });
      const telegram = createMockTelegramApi();
      const logger = createMockLogger();

      await runStartupChecks({ config, telegram, logger });

      const logs = logger.getLogs();
      const claudePassLog = logs.find((l) => l.message === "startup check passed: claude");
      expect(claudePassLog?.details).toHaveProperty("provider", "custom-base-url");
    });

    test("should detect unknown provider when no auth configured", async () => {
      const config = createMockConfig({ workspaceRoot: testDir });
      const telegram = createMockTelegramApi();
      const logger = createMockLogger();

      await runStartupChecks({ config, telegram, logger });

      const logs = logger.getLogs();
      const claudePassLog = logs.find((l) => l.message === "startup check passed: claude");
      expect(claudePassLog?.details).toHaveProperty("provider", "unknown");
    });

    test("should include note about deferred verification", async () => {
      const config = createMockConfig({
        workspaceRoot: testDir,
        anthropicApiKey: "api-key",
      });
      const telegram = createMockTelegramApi();
      const logger = createMockLogger();

      await runStartupChecks({ config, telegram, logger });

      const logs = logger.getLogs();
      const claudePassLog = logs.find((l) => l.message === "startup check passed: claude");
      expect(claudePassLog?.details).toHaveProperty("note");
      expect((claudePassLog?.details as any).note).toContain(
        "Deep Claude verification is deferred",
      );
    });
  });

  describe("integration", () => {
    test("should run all checks in order", async () => {
      const config = createMockConfig({
        workspaceRoot: testDir,
        anthropicApiKey: "api-key",
      });
      const telegram = createMockTelegramApi();
      const logger = createMockLogger();

      await runStartupChecks({ config, telegram, logger });

      const logs = logger.getLogs();
      const messages = logs.map((l) => l.message);

      // Checks should run in order
      const telegramIndex = messages.indexOf("startup check: telegram");
      const workspaceIndex = messages.indexOf("startup check: workspace root");
      const claudeIndex = messages.indexOf("startup check: claude");

      expect(telegramIndex).toBeLessThan(workspaceIndex);
      expect(workspaceIndex).toBeLessThan(claudeIndex);
    });

    test("should complete all checks without error", async () => {
      mkdirSync(join(testDir, "sample-project"));
      const config = createMockConfig({
        workspaceRoot: testDir,
        anthropicApiKey: "api-key",
      });
      const telegram = createMockTelegramApi();
      const logger = createMockLogger();

      await expect(runStartupChecks({ config, telegram, logger })).resolves.toBeUndefined();

      const logs = logger.getLogs();
      const passedChecks = logs.filter((l) => l.message.startsWith("startup check passed:"));
      expect(passedChecks.length).toBe(3);
    });
  });
});
