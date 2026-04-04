import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Logger } from "../logger.ts";

describe("Logger", () => {
  let testLogDir: string;
  let logger: Logger;

  beforeEach(() => {
    testLogDir = join(tmpdir(), `cc-im-logs-${Date.now()}`);
    logger = new Logger(testLogDir);
  });

  afterEach(() => {
    try {
      rmSync(testLogDir, { recursive: true, force: true });
    } catch {}
  });

  test("should create log directory if it doesn't exist", () => {
    const newLogDir = join(tmpdir(), `cc-im-new-logs-${Date.now()}`);
    expect(() => new Logger(newLogDir)).not.toThrow();
    const stats = statSync(newLogDir);
    expect(stats.isDirectory()).toBe(true);
    rmSync(newLogDir, { recursive: true, force: true });
  });

  test("should work with existing log directory", () => {
    mkdirSync(testLogDir, { recursive: true });
    expect(() => new Logger(testLogDir)).not.toThrow();
  });

  describe("info", () => {
    test("should write info message to app.log", () => {
      logger.info("test message");
      const logContent = readFileSync(join(testLogDir, "app.log"), "utf8");
      expect(logContent).toContain("[info]");
      expect(logContent).toContain("test message");
    });

    test("should include ISO timestamp", () => {
      logger.info("test message");
      const logContent = readFileSync(join(testLogDir, "app.log"), "utf8");
      // ISO format: 2026-04-04T...
      expect(logContent).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    test("should include details as JSON", () => {
      logger.info("test message", { key: "value", num: 42 });
      const logContent = readFileSync(join(testLogDir, "app.log"), "utf8");
      expect(logContent).toContain('"key":"value"');
      expect(logContent).toContain('"num":42');
    });

    test("should append multiple messages", () => {
      logger.info("message 1");
      logger.info("message 2");
      const logContent = readFileSync(join(testLogDir, "app.log"), "utf8");
      expect(logContent).toContain("message 1");
      expect(logContent).toContain("message 2");
    });

    test("should handle empty details", () => {
      logger.info("test message", undefined);
      const logContent = readFileSync(join(testLogDir, "app.log"), "utf8");
      expect(logContent.trim().endsWith("test message")).toBe(true);
    });

    test("should handle complex objects in details", () => {
      const complexObj = {
        nested: { array: [1, 2, 3], bool: true },
        nullValue: null,
        undefinedValue: undefined,
      };
      logger.info("complex", complexObj);
      const logContent = readFileSync(join(testLogDir, "app.log"), "utf8");
      expect(logContent).toContain("complex");
    });
  });

  describe("error", () => {
    test("should write error message to app.log", () => {
      logger.error("error message");
      const logContent = readFileSync(join(testLogDir, "app.log"), "utf8");
      expect(logContent).toContain("[error]");
      expect(logContent).toContain("error message");
    });

    test("should include error details", () => {
      logger.error("error message", { error: "something went wrong" });
      const logContent = readFileSync(join(testLogDir, "app.log"), "utf8");
      expect(logContent).toContain("something went wrong");
    });

    test("should log Error objects with toString", () => {
      const error = new Error("test error");
      logger.error("caught error", error);
      const logContent = readFileSync(join(testLogDir, "app.log"), "utf8");
      // Error objects serialize to {} with JSON.stringify
      // but the message should still appear
      expect(logContent).toContain("caught error");
    });
  });

  describe("run", () => {
    test("should write to run-specific log file", () => {
      logger.run("run-123", "step 1");
      const logContent = readFileSync(join(testLogDir, "run-123.log"), "utf8");
      expect(logContent).toContain("[run]");
      expect(logContent).toContain("step 1");
    });

    test("should create separate files for different run IDs", () => {
      logger.run("run-1", "message 1");
      logger.run("run-2", "message 2");

      const log1 = readFileSync(join(testLogDir, "run-1.log"), "utf8");
      const log2 = readFileSync(join(testLogDir, "run-2.log"), "utf8");

      expect(log1).toContain("message 1");
      expect(log1).not.toContain("message 2");
      expect(log2).toContain("message 2");
      expect(log2).not.toContain("message 1");
    });

    test("should append to existing run log", () => {
      logger.run("run-123", "first");
      logger.run("run-123", "second");
      const logContent = readFileSync(join(testLogDir, "run-123.log"), "utf8");
      expect(logContent).toContain("first");
      expect(logContent).toContain("second");
    });

    test("should handle run log with details", () => {
      logger.run("run-456", "step", { duration: 100, status: "ok" });
      const logContent = readFileSync(join(testLogDir, "run-456.log"), "utf8");
      expect(logContent).toContain("duration");
      expect(logContent).toContain("status");
    });

    test("should handle special characters in run ID", () => {
      logger.run("run-with-dashes_and.underscores", "message");
      const files = readdirSync(testLogDir);
      expect(files).toContain("run-with-dashes_and.underscores.log");
    });
  });

  describe("format consistency", () => {
    test("should use consistent format across methods", () => {
      logger.info("info msg");
      logger.error("error msg");
      logger.run("run-id", "run msg");

      const appLog = readFileSync(join(testLogDir, "app.log"), "utf8");
      const runLog = readFileSync(join(testLogDir, "run-id.log"), "utf8");

      // Each line should end with newline
      expect(appLog.endsWith("\n")).toBe(true);
      expect(runLog.endsWith("\n")).toBe(true);

      // Should have timestamp at start
      expect(appLog).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(runLog).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    test("should handle unicode in messages", () => {
      logger.info("Unicode: 你好 🎉 émojis");
      const logContent = readFileSync(join(testLogDir, "app.log"), "utf8");
      expect(logContent).toContain("你好");
      expect(logContent).toContain("🎉");
    });

    test("should handle long messages", () => {
      const longMessage = "a".repeat(10000);
      logger.info(longMessage);
      const logContent = readFileSync(join(testLogDir, "app.log"), "utf8");
      expect(logContent).toContain(longMessage);
    });
  });
});
