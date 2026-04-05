import { describe, expect, test } from "bun:test";
import { buildClaudeCliArgs } from "../claude-cli.ts";

describe("buildClaudeCliArgs", () => {
  test("should start a new print session without resume flags", () => {
    const args = buildClaudeCliArgs({
      cwd: "/workspace",
      prompt: "Hello",
      mode: "interactive",
      env: {},
    });

    expect(args).not.toContain("--resume");
    expect(args).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-hook-events",
      "Hello",
    ]);
  });

  test("should resume an existing session when sessionId is present", () => {
    const args = buildClaudeCliArgs({
      cwd: "/workspace",
      prompt: "Follow up",
      sessionId: "session-123",
      mode: "interactive",
      env: {},
      debugFile: "./logs/test.log",
    });

    expect(args).toEqual([
      "--resume",
      "session-123",
      "--debug-file",
      "./logs/test.log",
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-hook-events",
      "Follow up",
    ]);
  });

  test("should include dangerous permissions flag when enabled", () => {
    const args = buildClaudeCliArgs({
      cwd: "/workspace",
      prompt: "Do it",
      sessionId: "session-123",
      mode: "dangerous",
      env: {},
    });

    expect(args[0]).toBe("--dangerously-skip-permissions");
    expect(args).toContain("--resume");
  });
});
