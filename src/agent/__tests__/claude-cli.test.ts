import { describe, expect, test } from "bun:test";
import {
  buildClaudeCliArgs,
  extractSessionSummaryFromChunk,
  parseSlashCommandsFromInitLine,
  sanitizeClaudePath,
} from "../claude-cli.ts";

describe("buildClaudeCliArgs", () => {
  test("should start a new print session without resume flags", () => {
    const args = buildClaudeCliArgs({
      cwd: "/workspace",
      prompt: "Hello",
      mode: "default",
      env: {},
    });

    expect(args).not.toContain("--resume");
    expect(args).toEqual([
      "-p",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-hook-events",
      "--replay-user-messages",
      "--permission-mode",
      "default",
    ]);
  });

  test("should resume an existing session when sessionId is present", () => {
    const args = buildClaudeCliArgs({
      cwd: "/workspace",
      prompt: "Follow up",
      sessionId: "session-123",
      mode: "acceptEdits",
      env: {},
      debugFile: "./logs/test.log",
    });

    expect(args).toEqual([
      "--resume",
      "session-123",
      "--debug-file",
      "./logs/test.log",
      "-p",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-hook-events",
      "--replay-user-messages",
      "--permission-mode",
      "acceptEdits",
    ]);
  });

  test("should map bypass permissions mode to permission flag", () => {
    const args = buildClaudeCliArgs({
      cwd: "/workspace",
      sessionId: "session-123",
      mode: "bypassPermissions",
      env: {},
    });

    expect(args).toContain("--permission-mode");
    expect(args).toContain("bypassPermissions");
    expect(args).toContain("--resume");
  });

  test("should parse slash commands from init stream-json line", () => {
    const commands = parseSlashCommandsFromInitLine(
      JSON.stringify({
        type: "system",
        subtype: "init",
        slash_commands: ["/debug", "review"],
      }),
    );

    expect(commands).toEqual(["debug", "review"]);
  });

  test("should extract first user message from transcript chunk", () => {
    const summary = extractSessionSummaryFromChunk(
      [
        JSON.stringify({ type: "permission-mode", permissionMode: "default" }),
        JSON.stringify({
          type: "user",
          message: { role: "user", content: "resume this session please" },
        }),
      ].join("\n"),
    );

    expect(summary).toBe("resume this session please");
  });

  test("should fall back to session placeholder when transcript has no user text", () => {
    const summary = extractSessionSummaryFromChunk(
      JSON.stringify({ type: "assistant", message: { content: "hello" } }),
    );

    expect(summary).toBe("(session)");
  });

  test("should sanitize workspace paths like Claude Code projects dir", () => {
    expect(sanitizeClaudePath("/Users/bytedance/workspace/cc-im")).toBe(
      "-Users-bytedance-workspace-cc-im",
    );
  });
});
