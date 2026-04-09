import { describe, expect, test } from "bun:test";
import type { AppConfig } from "../../config.ts";
import type { Logger } from "../../logger.ts";
import type { CliRunner } from "../cli-runner.ts";
import {
  CliAdapter,
  createClaudeStreamState,
  mapClaudeStreamJsonEvent,
  tryParseClaudeStreamJsonLine,
} from "../cli-adapter.ts";

describe("Claude stream-json parsing", () => {
  test("should parse init event into commands and ready status", () => {
    const state = createClaudeStreamState();
    const events = mapClaudeStreamJsonEvent(
      {
        type: "system",
        subtype: "init",
        session_id: "session-123",
        slash_commands: ["debug", "review"],
      },
      state,
    );

    expect(events).toEqual([
      { type: "commands", commands: ["debug", "review"] },
      { type: "status", message: "Claude session ready: session-123" },
    ]);
  });

  test("should normalize slash commands from init event", () => {
    const state = createClaudeStreamState();
    const events = mapClaudeStreamJsonEvent(
      {
        type: "system",
        subtype: "init",
        session_id: "session-123",
        slash_commands: ["/debug", "review"],
      },
      state,
    );

    expect(events[0]).toEqual({ type: "commands", commands: ["debug", "review"] });
  });

  test("should parse assistant text and tool use blocks", () => {
    const state = createClaudeStreamState();
    const events = mapClaudeStreamJsonEvent(
      {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Working on it" },
            { type: "tool_use", id: "tool-1", name: "Read", input: { file_path: "src/main.ts" } },
          ],
        },
      },
      state,
    );

    expect(events).toEqual([
      { type: "assistant_text", text: "Working on it" },
      { type: "status", message: "tool:start:Read|src/main.ts" },
    ]);
  });

  test("should map tool result back to tool end status", () => {
    const state = createClaudeStreamState();
    mapClaudeStreamJsonEvent(
      {
        type: "assistant",
        message: {
          content: [{ type: "tool_use", id: "tool-1", name: "Bash" }],
        },
      },
      state,
    );

    const events = mapClaudeStreamJsonEvent(
      {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-1",
              content: [{ type: "text", text: "Command finished successfully" }],
            },
          ],
        },
      },
      state,
    );

    expect(events).toEqual([
      { type: "status", message: "tool:end:Bash|Command finished successfully" },
    ]);
  });

  test("should surface result text when no assistant text blocks were emitted", () => {
    const state = createClaudeStreamState();
    const events = mapClaudeStreamJsonEvent(
      {
        type: "result",
        subtype: "success",
        result: "Unknown skill: skills",
      },
      state,
    );

    expect(events).toEqual([
      { type: "assistant_text", text: "Unknown skill: skills" },
      { type: "status", message: "phase:completed" },
    ]);
  });

  test("should parse json line safely", () => {
    const parsed = tryParseClaudeStreamJsonLine('{"type":"result","subtype":"success"}');

    expect(parsed).toEqual({ type: "result", subtype: "success" });
    expect(tryParseClaudeStreamJsonLine("plain text")).toBeUndefined();
  });

  test("should not fabricate a session id before Claude returns a real one", async () => {
    const logger = {
      info: () => {},
      error: () => {},
      run: () => {},
    } as unknown as Logger;
    const adapter = new CliAdapter(
      {
        telegramBotToken: "test-token",
        telegramAllowedChatId: 123456789,
        workspaceRoot: "/workspace",
        logDir: "./logs",
        agentProvider: "claude",
        claudeCommandsPageSize: 8,
        claudeApprovalTimeoutMs: 300000,
        claudeInputEditTimeoutMs: 300000,
        claudeDefaultPermissionMode: "default",
        telegramProgressDebounceMs: 2000,
        telegramProgressMinIntervalMs: 10000,
      } satisfies AppConfig,
      logger,
    );

    (adapter as unknown as { runner: CliRunner }).runner = {
      name: "claude",
      checkInstalled: async () => true,
      probeSlashCommands: async () => [],
      run: () => ({
        stdout: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        stderr: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        writeStdin: () => {},
        closeStdin: () => {},
        kill: () => {},
        exited: Promise.resolve(0),
      }),
    };

    const result = await adapter.sendMessage({
      runId: "run-123",
      workspacePath: "/workspace",
      message: "Hello",
      mode: "default",
      onEvent: () => {},
    });

    expect(result.sessionId).toBe("");
  });
});
