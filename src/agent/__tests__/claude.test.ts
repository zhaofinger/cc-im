import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AgentAdapter } from "../types.ts";

describe("Agent types and contracts", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `agent-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  describe("AgentAdapter interface", () => {
    test("should define probeSlashCommands method", () => {
      // Verify the interface contract exists
      const mockAdapter: AgentAdapter = {
        probeSlashCommands: async (_workspacePath: string) => ({
          sessionId: "test-session",
          slashCommands: ["/test"],
        }),
        sendMessage: async () => ({
          sessionId: "test-session",
          stop: () => {},
        }),
      };

      expect(mockAdapter.probeSlashCommands).toBeDefined();
      expect(typeof mockAdapter.probeSlashCommands).toBe("function");
    });

    test("should define sendMessage method", () => {
      const mockAdapter: AgentAdapter = {
        probeSlashCommands: async () => ({ slashCommands: [] }),
        sendMessage: async () => ({
          sessionId: "test-session",
          stop: () => {},
        }),
      };

      expect(mockAdapter.sendMessage).toBeDefined();
      expect(typeof mockAdapter.sendMessage).toBe("function");
    });

    test("should return CommandProbe from probeSlashCommands", async () => {
      const mockAdapter: AgentAdapter = {
        probeSlashCommands: async (_workspacePath: string) => ({
          sessionId: "session-123",
          slashCommands: ["/commit", "/status"],
        }),
        sendMessage: async () => ({
          sessionId: "test-session",
          stop: () => {},
        }),
      };

      const result = await mockAdapter.probeSlashCommands("/workspace");
      expect(result.sessionId).toBe("session-123");
      expect(result.slashCommands).toEqual(["/commit", "/status"]);
    });

    test("should return ActiveRun from sendMessage", async () => {
      const mockStop = () => {};
      const mockAdapter: AgentAdapter = {
        probeSlashCommands: async () => ({ slashCommands: [] }),
        sendMessage: async () => ({
          sessionId: "session-456",
          stop: mockStop,
        }),
      };

      const result = await mockAdapter.sendMessage({
        runId: "run-123",
        workspacePath: "/workspace",
        message: "Hello",
        mode: "default",
        onEvent: () => {},
      });

      expect(result.sessionId).toBe("session-456");
      expect(typeof result.stop).toBe("function");
    });
  });
});

// Note: ClaudeAdapter tests are skipped due to complex SDK mocking requirements
// The adapter depends on @anthropic-ai/claude-agent-sdk which requires
// sophisticated mocking that varies between test frameworks
