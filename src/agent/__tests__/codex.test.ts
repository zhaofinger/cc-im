import { describe, expect, test, beforeEach } from "bun:test";
import { CodexAdapter } from "../codex.ts";

describe("CodexAdapter", () => {
  let adapter: CodexAdapter;

  beforeEach(() => {
    adapter = new CodexAdapter();
  });

  describe("probeSlashCommands", () => {
    test("should return empty slash commands", async () => {
      const result = await adapter.probeSlashCommands();

      expect(result).toBeDefined();
      expect(result.slashCommands).toEqual([]);
      expect(result.sessionId).toBeUndefined();
    });

    test("should return consistent empty result", async () => {
      const results = await Promise.all([
        adapter.probeSlashCommands(),
        adapter.probeSlashCommands(),
        adapter.probeSlashCommands(),
      ]);

      results.forEach((result) => {
        expect(result.slashCommands).toEqual([]);
        expect(result.sessionId).toBeUndefined();
      });
    });
  });

  describe("sendMessage", () => {
    test("should throw not implemented error", async () => {
      await expect(
        adapter.sendMessage({
          runId: "run-123",
          workspacePath: "/workspace",
          message: "Hello",
          onEvent: () => {},
        }),
      ).rejects.toThrow("CodexAdapter is not implemented yet");
    });

    test("should throw regardless of options", async () => {
      await expect(
        adapter.sendMessage({
          runId: "any-id",
          workspacePath: "/any/path",
          sessionId: "session-123",
          message: "Any message",
          requestApproval: async () => "approve",
          onEvent: () => {},
        }),
      ).rejects.toThrow("CodexAdapter is not implemented yet");
    });

    test("should throw for empty message", async () => {
      await expect(
        adapter.sendMessage({
          runId: "run-123",
          workspacePath: "/workspace",
          message: "",
          onEvent: () => {},
        }),
      ).rejects.toThrow("CodexAdapter is not implemented yet");
    });
  });
});
