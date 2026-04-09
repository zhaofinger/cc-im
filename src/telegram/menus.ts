import { InlineKeyboard } from "grammy";
import type { PermissionMode } from "../types.ts";
import { chunk } from "../utils/array.ts";

export function buildWorkspaceMenu(workspaces: string[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const row of chunk(workspaces, 2)) {
    row.forEach((workspace) => {
      keyboard.text(workspace, `ws:${workspace}`);
    });
    keyboard.row();
  }
  return keyboard;
}

export function buildClaudeCommandsMenu(
  commands: string[],
  page: number,
  pageSize: number,
): InlineKeyboard {
  const totalPages = Math.max(1, Math.ceil(commands.length / pageSize));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const start = safePage * pageSize;
  const visible = commands.slice(start, start + pageSize);
  const keyboard = new InlineKeyboard();
  for (const row of chunk(visible, 2)) {
    row.forEach((command) => {
      keyboard.text(`/${command}`, `ccrun:${command}`);
    });
    keyboard.row();
  }
  if (safePage > 0) {
    keyboard.text("Prev", `ccpage:${safePage - 1}`);
  }
  keyboard.text(`${safePage + 1}/${totalPages}`, "noop");
  if (safePage < totalPages - 1) {
    keyboard.text("Next", `ccpage:${safePage + 1}`);
  }
  return keyboard;
}

export function buildApprovalMenu(approvalId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Approve once", `approve:${approvalId}`)
    .text("Edit input", `edit:${approvalId}`)
    .text("Reject", `reject:${approvalId}`);
}

export function buildModeMenu(_currentMode: PermissionMode): InlineKeyboard {
  const modes: Array<{ label: string; value: PermissionMode }> = [
    { label: "default mode on", value: "default" },
    { label: "⏵︎⏵︎ acceptEdits mode on", value: "acceptEdits" },
    { label: "auto mode on", value: "auto" },
    { label: "⏵︎⏵︎ dontAsk mode on", value: "dontAsk" },
    { label: "plan mode on", value: "plan" },
    { label: "⏵︎⏵︎ bypassPermissions mode on", value: "bypassPermissions" },
  ];

  const keyboard = new InlineKeyboard();
  for (const mode of modes) {
    keyboard.text(mode.label, `mode:${mode.value}`);
    keyboard.row();
  }
  return keyboard;
}
