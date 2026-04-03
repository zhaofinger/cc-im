export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function markdownToTelegramHtml(md: string): string {
  const codeBlockMarker = "__CC_IM_CODE_BLOCK__";
  const inlineCodeMarker = "__CC_IM_INLINE_CODE__";
  const codeBlocks: string[] = [];
  let text = md.replace(/```[\s\S]*?```/g, (match) => {
    const code = match.replace(/^```\w*\n?/, "").replace(/\n?```$/, "");
    codeBlocks.push(`<pre><code>${escapeHtml(code)}</code></pre>`);
    return `${codeBlockMarker}${codeBlocks.length - 1}__`;
  });

  const inlineCodes: string[] = [];
  text = text.replace(/`([^`]+)`/g, (_, code: string) => {
    inlineCodes.push(`<code>${escapeHtml(code)}</code>`);
    return `${inlineCodeMarker}${inlineCodes.length - 1}__`;
  });

  text = escapeHtml(text);
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  text = text.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  text = text.replace(/__(.+?)__/g, "<b>$1</b>");
  text = text.replace(/~~(.+?)~~/g, "<s>$1</s>");
  text = text.replace(/(?<!\w)\*(?!\s)(.+?)(?<!\s)\*(?!\w)/g, "<i>$1</i>");
  text = text.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");

  text = text.replace(/__CC_IM_CODE_BLOCK__(\d+)__/g, (_, i) => codeBlocks[Number(i)] || "");
  text = text.replace(/__CC_IM_INLINE_CODE__(\d+)__/g, (_, i) => inlineCodes[Number(i)] || "");
  return text;
}
