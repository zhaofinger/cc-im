import { InlineKeyboard } from "grammy";

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size));
  }
  return rows;
}

export function buildWorkspaceMenu(workspaces: string[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const row of chunk(workspaces, 2)) {
    row.forEach((workspace, index) => {
      keyboard.text(workspace, `ws:${workspace}`);
      if (index === row.length - 1) {
        return;
      }
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
    .text("Reject", `reject:${approvalId}`);
}
