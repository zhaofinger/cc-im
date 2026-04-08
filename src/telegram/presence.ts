export const MESSAGE_REACTION_EMOJIS = ["👀", "🫡", "⚡", "🎉", "🔥", "👌", "👏", "🤔"] as const;
export type MessageReactionEmoji = (typeof MESSAGE_REACTION_EMOJIS)[number];

export function pickMessageReactionEmoji(): MessageReactionEmoji {
  const index = Math.floor(Math.random() * MESSAGE_REACTION_EMOJIS.length);
  return MESSAGE_REACTION_EMOJIS[index] || MESSAGE_REACTION_EMOJIS[0];
}

export function buildStartupNotification(args: {
  provider: "claude" | "codex";
  username?: string;
  workspaceRoot: string;
}): string {
  const lines = [
    "<b>✅ CC-IM Started</b>",
    `<i>${escapeHtml(args.username ? `@${args.username}` : "telegram bot ready")}</i>`,
    `<i>${escapeHtml(`provider ${args.provider}`)}</i>`,
    "",
    "<b>Workspace Root</b>",
    `<blockquote>${escapeHtml(args.workspaceRoot)}</blockquote>`,
  ];
  return lines.join("\n");
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
