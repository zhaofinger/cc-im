export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Use STX (\u0002) and ETX (\u0003) control characters as markers because:
// 1. They are extremely unlikely to appear in normal Markdown text
// 2. They are single characters, making the regex patterns more efficient
// 3. They have distinct start/end meanings (STX = Start of Text, ETX = End of Text)
const MARKER_STX = "\u0002";
const MARKER_ETX = "\u0003";
const CODE_BLOCK_MARKER = `${MARKER_STX}CCIMCB`;
const INLINE_CODE_MARKER = `${MARKER_ETX}CCIMIC`;

export function markdownToTelegramHtml(md: string): string {
  const codeBlocks: string[] = [];
  let text = md.replace(/```[\s\S]*?```/g, (match) => {
    const code = match.replace(/^```\w*\n?/, "").replace(/\n?```$/, "");
    codeBlocks.push(`<pre><code>${escapeHtml(code)}</code></pre>`);
    return `${CODE_BLOCK_MARKER}${codeBlocks.length - 1}${MARKER_STX}`;
  });

  text = replaceMarkdownTables(text, (tableText) => {
    const listText = markdownTableToList(tableText);
    codeBlocks.push(`<pre><code>${escapeHtml(listText)}</code></pre>`);
    return `${CODE_BLOCK_MARKER}${codeBlocks.length - 1}${MARKER_STX}`;
  });

  const inlineCodes: string[] = [];
  text = text.replace(/`([^`]+)`/g, (_, code: string) => {
    inlineCodes.push(`<code>${escapeHtml(code)}</code>`);
    return `${INLINE_CODE_MARKER}${inlineCodes.length - 1}${MARKER_ETX}`;
  });

  text = escapeHtml(text);
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  text = text.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  text = text.replace(/__(.+?)__/g, "<b>$1</b>");
  text = text.replace(/~~(.+?)~~/g, "<s>$1</s>");
  text = text.replace(/(?<!\w)\*(?!\s)(.+?)(?<!\s)\*(?!\w)/g, "<i>$1</i>");
  text = text.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");

  text = text.replace(/\u0002CCIMCB(\d+)\u0002/g, (_, i) => codeBlocks[Number(i)] || "");
  text = text.replace(/\u0003CCIMIC(\d+)\u0003/g, (_, i) => inlineCodes[Number(i)] || "");
  return text;
}

function replaceMarkdownTables(text: string, replacer: (tableText: string) => string): string {
  const lines = text.split("\n");
  const output: string[] = [];
  let index = 0;

  while (index < lines.length) {
    if (isMarkdownTableHeader(lines, index)) {
      const tableLines = [lines[index], lines[index + 1]];
      index += 2;

      while (index < lines.length && isMarkdownTableRow(lines[index])) {
        tableLines.push(lines[index]);
        index += 1;
      }

      output.push(replacer(tableLines.join("\n")));
      continue;
    }

    output.push(lines[index]);
    index += 1;
  }

  return output.join("\n");
}

function isMarkdownTableHeader(lines: string[], index: number): boolean {
  if (index + 1 >= lines.length) {
    return false;
  }

  return isMarkdownTableRow(lines[index]) && isMarkdownTableSeparator(lines[index + 1]);
}

function isMarkdownTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("|") && trimmed.endsWith("|") && trimmed.includes("|");
}

function isMarkdownTableSeparator(line: string): boolean {
  return /^\s*\|(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(line);
}

function markdownTableToList(tableText: string): string {
  const rows = tableText
    .split("\n")
    .map(parseMarkdownTableRow)
    .filter((row) => row.length > 0);

  if (rows.length < 3) {
    return tableText;
  }

  const headers = rows[0];
  const bodyRows = rows.slice(2);

  return bodyRows
    .map((row) => {
      const title = row[0] || headers[0] || "item";
      const details = row
        .slice(1)
        .map((value, index) => {
          const header = headers[index + 1];
          return header ? `${header}: ${value}` : value;
        })
        .filter(Boolean)
        .join(" | ");
      return details ? `${title}: ${details}` : title;
    })
    .join("\n");
}

function parseMarkdownTableRow(line: string): string[] {
  return line
    .trim()
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}
