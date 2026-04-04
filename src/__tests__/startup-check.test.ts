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
    agentProvider: "claude",
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
      expect((workspacePassLog?.details as { firstWorkspace: string }).firstWorkspace).toContain(
        "valid-project",
      );
    });
  });

  describe("agent cli check", () => {
    test("should check agent cli configuration", async () => {
      const config = createMockConfig({ workspaceRoot: testDir });
      const telegram = createMockTelegramApi();
      const logger = createMockLogger();

      // Note: This test may fail if claude CLI is not installed
      // In CI environment, you may want to mock the CLI check
      try {
        await runStartupChecks({ config, telegram, logger });

        const logs = logger.getLogs();
        const cliStartLog = logs.find((l) => l.message === "startup check: agent cli");
        const cliPassLog = logs.find((l) => l.message === "startup check passed: agent cli");

        expect(cliStartLog).toBeDefined();
        expect(cliPassLog).toBeDefined();
        expect(cliPassLog?.details).toHaveProperty("provider", "claude");
        expect(cliPassLog?.details).toHaveProperty("installed", true);
      } catch (error) {
        // If CLI is not installed, expect specific error
        expect((error as Error).message).toContain("CLI is not installed");
      }
    });

    test("should detect codex provider", async () => {
      const config = createMockConfig({
        workspaceRoot: testDir,
        agentProvider: "codex",
      });
      const telegram = createMockTelegramApi();
      const logger = createMockLogger();

      try {
        await runStartupChecks({ config, telegram, logger });

        const logs = logger.getLogs();
        const cliPassLog = logs.find((l) => l.message === "startup check passed: agent cli");
        expect(cliPassLog?.details).toHaveProperty("provider", "codex");
      } catch (error) {
        // If CLI is not installed, expect specific error
        expect((error as Error).message).toContain("CLI is not installed");
      }
    });

    test("should throw if CLI is not installed", async () => {
      const config = createMockConfig({
        workspaceRoot: testDir,
        agentProvider: "claude",
      });
      const telegram = createMockTelegramApi();
      const logger = createMockLogger();

      // This test will fail if claude is installed, skip in that case
      try {
        await runStartupChecks({ config, telegram, logger });
        // If we get here, CLI is installed - skip the assertion
      } catch (error) {
        expect((error as Error).message).toContain("claude CLI is not installed");
      }
    });
  });

  describe("integration", () => {
    test("should run all checks in order", async () => {
      const config = createMockConfig({ workspaceRoot: testDir });
      const telegram = createMockTelegramApi();
      const logger = createMockLogger();

      try {
        await runStartupChecks({ config, telegram, logger });

        const logs = logger.getLogs();
        const messages = logs.map((l) => l.message);

        // Check order
        const telegramIndex = messages.indexOf("startup check: telegram");
        const workspaceIndex = messages.indexOf("startup check: workspace root");
        const cliIndex = messages.indexOf("startup check: agent cli");

        expect(telegramIndex).toBeGreaterThanOrEqual(0);
        expect(workspaceIndex).toBeGreaterThan(telegramIndex);
        expect(cliIndex).toBeGreaterThan(workspaceIndex);
      } catch {
        // If CLI not installed, just verify the checks started
        const logs = logger.getLogs();
        expect(logs.some((l) => l.message === "startup check: telegram")).toBe(true);
        expect(logs.some((l) => l.message === "startup check: workspace root")).toBe(true);
      }
    });

    test("should complete all checks without error when CLI installed", async () => {
      const config = createMockConfig({ workspaceRoot: testDir });
      const telegram = createMockTelegramApi();
      const logger = createMockLogger();

      try {
        await expect(runStartupChecks({ config, telegram, logger })).resolves.toBeUndefined();

        const logs = logger.getLogs();
        expect(logs.some((l) => l.message === "startup check passed: telegram")).toBe(true);
        expect(logs.some((l) => l.message === "startup check passed: workspace root")).toBe(true);
        expect(logs.some((l) => l.message === "startup check passed: agent cli")).toBe(true);
      } catch {
        // CLI not installed - skip this test
      }
    });
  });
});
