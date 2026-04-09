import { describe, expect, test } from "bun:test";
import { buildWorkspaceMenu, buildClaudeCommandsMenu, buildApprovalMenu } from "../menus.ts";

// Helper to get callback_data from button
// Inline keyboard buttons can be various types, we need to extract callback_data from text buttons
type CallbackButton = { text: string; callback_data: string };

function getCallbackData(btn: unknown): string | undefined {
  return (btn as CallbackButton).callback_data;
}

describe("buildWorkspaceMenu", () => {
  test("should create inline keyboard with workspaces", () => {
    const menu = buildWorkspaceMenu(["project1", "project2"]);
    expect(menu).toBeDefined();
    expect(menu.inline_keyboard).toBeDefined();
  });

  test("should create buttons for each workspace", () => {
    const menu = buildWorkspaceMenu(["project1", "project2", "project3"]);
    // 3 workspaces chunked into 2 per row = 2 rows of buttons + empty row from final .row()
    expect(menu.inline_keyboard.length).toBe(3);
    expect(menu.inline_keyboard[0].length).toBe(2);
    expect(menu.inline_keyboard[1].length).toBe(1);
  });

  test("should set correct callback data", () => {
    const menu = buildWorkspaceMenu(["my-project"]);
    expect(menu.inline_keyboard[0][0].text).toBe("my-project");
    expect(getCallbackData(menu.inline_keyboard[0][0])).toBe("ws:my-project");
  });

  test("should handle single workspace", () => {
    const menu = buildWorkspaceMenu(["only-project"]);
    // 1 row with button + empty row from final .row()
    expect(menu.inline_keyboard.length).toBe(2);
    expect(menu.inline_keyboard[0].length).toBe(1);
  });

  test("should handle empty workspaces array", () => {
    const menu = buildWorkspaceMenu([]);
    // Empty array produces just the final .row() empty row
    expect(menu.inline_keyboard.length).toBe(1);
    expect(menu.inline_keyboard[0].length).toBe(0);
  });

  test("should handle many workspaces", () => {
    const workspaces = Array.from({ length: 10 }, (_, i) => `project${i}`);
    const menu = buildWorkspaceMenu(workspaces);
    // 10 workspaces / 2 per row = 5 rows + final .row() empty row
    expect(menu.inline_keyboard.length).toBe(6);
    // Verify all workspaces are present
    const allButtons = menu.inline_keyboard.flat();
    expect(allButtons.length).toBe(10);
  });

  test("should handle workspaces with special characters", () => {
    const menu = buildWorkspaceMenu(["my-project_v2", "project.name"]);
    expect(getCallbackData(menu.inline_keyboard[0][0])).toBe("ws:my-project_v2");
    expect(getCallbackData(menu.inline_keyboard[0][1])).toBe("ws:project.name");
  });
});

describe("buildClaudeCommandsMenu", () => {
  test("should create menu with commands", () => {
    const menu = buildClaudeCommandsMenu(["commit", "status"], 0, 8);
    expect(menu).toBeDefined();
  });

  test("should show commands with page indicator", () => {
    const menu = buildClaudeCommandsMenu(["commit", "status"], 0, 8);
    // Should have command buttons + navigation row
    expect(menu.inline_keyboard.length).toBe(2);
    // Navigation row with 1/N and possibly prev/next
    const navRow = menu.inline_keyboard[menu.inline_keyboard.length - 1];
    expect(navRow.some((btn) => btn.text === "1/1")).toBe(true);
  });

  test("should paginate commands", () => {
    const commands = Array.from({ length: 20 }, (_, i) => `cmd${i}`);
    const menu = buildClaudeCommandsMenu(commands, 0, 8);

    // Page 0 should show commands 0-7
    expect(menu.inline_keyboard.length).toBe(5); // 4 rows of commands + nav
    const navRow = menu.inline_keyboard[menu.inline_keyboard.length - 1];
    expect(navRow.some((btn) => btn.text === "1/3")).toBe(true);
  });

  test("should show next button when more pages exist", () => {
    const commands = Array.from({ length: 10 }, (_, i) => `cmd${i}`);
    const menu = buildClaudeCommandsMenu(commands, 0, 8);

    const navRow = menu.inline_keyboard[menu.inline_keyboard.length - 1];
    const hasNextButton = navRow.some(
      (btn) => btn.text === "Next" && getCallbackData(btn) === "ccpage:1",
    );
    expect(hasNextButton).toBe(true);
  });

  test("should show prev button on page 1+", () => {
    const commands = Array.from({ length: 16 }, (_, i) => `cmd${i}`);
    const menu = buildClaudeCommandsMenu(commands, 1, 8);

    const navRow = menu.inline_keyboard[menu.inline_keyboard.length - 1];
    const hasPrevButton = navRow.some(
      (btn) => btn.text === "Prev" && getCallbackData(btn) === "ccpage:0",
    );
    expect(hasPrevButton).toBe(true);
  });

  test("should handle empty commands list", () => {
    const menu = buildClaudeCommandsMenu([], 0, 8);
    // Should still show navigation with 1/1
    expect(menu.inline_keyboard.length).toBe(1);
    expect(menu.inline_keyboard[0].some((btn) => btn.text === "1/1")).toBe(true);
  });

  test("should clamp page number to valid range", () => {
    const commands = ["cmd1", "cmd2"];
    const menu = buildClaudeCommandsMenu(commands, 100, 8);
    const navRow = menu.inline_keyboard[menu.inline_keyboard.length - 1];
    expect(navRow.some((btn) => btn.text === "1/1")).toBe(true);
  });

  test("should handle negative page number", () => {
    const commands = ["cmd1", "cmd2"];
    const menu = buildClaudeCommandsMenu(commands, -5, 8);
    const navRow = menu.inline_keyboard[menu.inline_keyboard.length - 1];
    expect(navRow.some((btn) => btn.text === "1/1")).toBe(true);
  });

  test("should set correct callback data for commands", () => {
    const menu = buildClaudeCommandsMenu(["commit", "status"], 0, 8);
    expect(getCallbackData(menu.inline_keyboard[0][0])).toBe("ccrun:commit");
    expect(getCallbackData(menu.inline_keyboard[0][1])).toBe("ccrun:status");
  });

  test("should format command buttons with leading slash", () => {
    const menu = buildClaudeCommandsMenu(["commit"], 0, 8);
    expect(menu.inline_keyboard[0][0].text).toBe("/commit");
  });

  test("should handle noop button in navigation", () => {
    const menu = buildClaudeCommandsMenu(["cmd"], 0, 8);
    const navRow = menu.inline_keyboard[menu.inline_keyboard.length - 1];
    expect(navRow.some((btn) => getCallbackData(btn) === "noop")).toBe(true);
  });

  test("should handle custom page size", () => {
    const commands = Array.from({ length: 12 }, (_, i) => `cmd${i}`);
    const menu = buildClaudeCommandsMenu(commands, 0, 4);
    // Should be 3 pages with 4 per page
    const navRow = menu.inline_keyboard[menu.inline_keyboard.length - 1];
    expect(navRow.some((btn) => btn.text === "1/3")).toBe(true);
  });
});

describe("buildApprovalMenu", () => {
  test("should create approval, edit, and reject buttons", () => {
    const menu = buildApprovalMenu("approval-123");
    expect(menu.inline_keyboard.length).toBe(1);
    expect(menu.inline_keyboard[0].length).toBe(3);
  });

  test("should set correct button text", () => {
    const menu = buildApprovalMenu("approval-123");
    expect(menu.inline_keyboard[0][0].text).toBe("Approve once");
    expect(menu.inline_keyboard[0][1].text).toBe("Edit input");
    expect(menu.inline_keyboard[0][2].text).toBe("Reject");
  });

  test("should set correct callback data", () => {
    const menu = buildApprovalMenu("approval-123");
    expect(getCallbackData(menu.inline_keyboard[0][0])).toBe("approve:approval-123");
    expect(getCallbackData(menu.inline_keyboard[0][1])).toBe("edit:approval-123");
    expect(getCallbackData(menu.inline_keyboard[0][2])).toBe("reject:approval-123");
  });

  test("should handle different approval IDs", () => {
    const menu = buildApprovalMenu("custom-id-abc");
    expect(getCallbackData(menu.inline_keyboard[0][0])).toBe("approve:custom-id-abc");
    expect(getCallbackData(menu.inline_keyboard[0][1])).toBe("edit:custom-id-abc");
    expect(getCallbackData(menu.inline_keyboard[0][2])).toBe("reject:custom-id-abc");
  });

  test("should handle approval ID with special characters", () => {
    const menu = buildApprovalMenu("id_with-special.chars");
    expect(getCallbackData(menu.inline_keyboard[0][0])).toBe("approve:id_with-special.chars");
  });
});
