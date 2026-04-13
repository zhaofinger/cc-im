import { describe, expect, test } from "bun:test";
import type { ChatState } from "../../types.ts";
import { buildStatusCardSections, renderPermissionModeLabel } from "../status-view.ts";

function createState(overrides: Partial<ChatState> = {}): ChatState {
  return {
    chatId: 123,
    status: "idle",
    permissionMode: "default",
    messageQueue: [],
    ...overrides,
  };
}

describe("status-view", () => {
  test("renders permission mode labels from one place", () => {
    expect(renderPermissionModeLabel("bypassPermissions")).toBe("⏵︎⏵︎ bypassPermissions mode on");
    expect(renderPermissionModeLabel(undefined, "plan")).toBe("plan mode on");
  });

  test("builds idle status sections", () => {
    const sections = buildStatusCardSections({
      state: createState({ permissionMode: "auto" }),
      fallbackMode: "default",
    });

    expect(sections.mode).toBe("auto mode on");
    expect(sections.state).toBeUndefined();
    expect(sections.run).toBeUndefined();
    expect(sections.approval).toBeUndefined();
  });

  test("prefers pending approval and includes tool metadata", () => {
    const sections = buildStatusCardSections({
      state: createState({
        status: "awaiting_approval",
        activeRunId: "run-123",
        pendingApproval: {
          id: "approval-1",
          runId: "run-123",
          request: {
            approvalId: "approval-1",
            toolName: "Bash",
            input: {},
          },
          createdAt: Date.now(),
        },
      }),
      activeRun: {
        runId: "run-123",
        phase: "Thinking",
      },
    });

    expect(sections.state).toBe("Awaiting approval for Bash");
    expect(sections.run).toBe("run-123\nThinking");
    expect(sections.approval).toBe("approval-1\nTool: Bash");
  });

  test("uses active run phase for running state", () => {
    const sections = buildStatusCardSections({
      state: createState({
        status: "running",
        activeRunId: "run-123",
      }),
      activeRun: {
        runId: "run-123",
        phase: "Using tool",
      },
    });

    expect(sections.state).toBe("Using tool");
    expect(sections.run).toBe("run-123\nUsing tool");
  });

  test("handles awaiting edited approval input", () => {
    const sections = buildStatusCardSections({
      state: createState({
        status: "awaiting_input_edit",
        pendingApproval: {
          id: "approval-1",
          runId: "run-123",
          request: {
            approvalId: "approval-1",
            toolName: "Edit",
            input: {},
          },
          createdAt: Date.now(),
        },
        pendingInputEdit: {
          approvalId: "approval-1",
          promptMessageId: 99,
        },
      }),
    });

    expect(sections.state).toBe("Awaiting edited approval input");
  });
});
