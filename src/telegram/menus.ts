import { InlineKeyboard } from "grammy";
import type { PermissionMode } from "../types.ts";
import { chunk } from "../utils/array.ts";
import { shorten } from "../utils/string.ts";
import type { ClaudeSession } from "../agent/claude-cli.ts";

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

const SESSION_SUMMARY_MAX_LEN = 32;
const SESSION_ID_SHORT_LEN = 8;

export function buildSessionsMenu(
  sessions: ClaudeSession[],
  page: number,
  pageSize: number,
): InlineKeyboard {
  const totalPages = Math.max(1, Math.ceil(sessions.length / pageSize));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const start = safePage * pageSize;
  const visible = sessions.slice(start, start + pageSize);
  const keyboard = new InlineKeyboard();

  for (const session of visible) {
    const label = [
      formatSessionDate(session.startedAt),
      `${Math.max(1, Math.round(session.sizeBytes / 1024))}KB`,
      session.sessionId.slice(0, SESSION_ID_SHORT_LEN),
      shorten(session.summary, SESSION_SUMMARY_MAX_LEN),
    ].join(" · ");
    keyboard.text(label, `resume:${session.sessionId}`).row();
  }

  if (safePage > 0) {
    keyboard.text("Prev", `rspage:${safePage - 1}`);
  }
  keyboard.text(`${safePage + 1}/${totalPages}`, "noop");
  if (safePage < totalPages - 1) {
    keyboard.text("Next", `rspage:${safePage + 1}`);
  }

  return keyboard;
}

function formatSessionDate(timestamp: number): string {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${month}_${day}`;
}
