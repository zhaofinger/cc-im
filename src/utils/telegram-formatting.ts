export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function markdownToTelegramHtml(md: string): string {
  const codeBlockMarker = "\u0002CCIMCODEBLOCK";
  const inlineCodeMarker = "\u0003CCIMINLINECODE";
  const codeBlocks: string[] = [];
  let text = md.replace(/```[\s\S]*?```/g, (match) => {
    const code = match.replace(/^```\w*\n?/, "").replace(/\n?```$/, "");
    codeBlocks.push(`<pre><code>${escapeHtml(code)}</code></pre>`);
    return `${codeBlockMarker}${codeBlocks.length - 1}\u0002`;
  });

  text = replaceMarkdownTables(text, (tableText) => {
    const listText = markdownTableToList(tableText);
    codeBlocks.push(`<pre><code>${escapeHtml(listText)}</code></pre>`);
    return `${codeBlockMarker}${codeBlocks.length - 1}\u0002`;
  });

  const inlineCodes: string[] = [];
  text = text.replace(/`([^`]+)`/g, (_, code: string) => {
    inlineCodes.push(`<code>${escapeHtml(code)}</code>`);
    return `${inlineCodeMarker}${inlineCodes.length - 1}\u0003`;
  });

  text = escapeHtml(text);
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  text = text.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  text = text.replace(/__(.+?)__/g, "<b>$1</b>");
  text = text.replace(/~~(.+?)~~/g, "<s>$1</s>");
  text = text.replace(/(?<!\w)\*(?!\s)(.+?)(?<!\s)\*(?!\w)/g, "<i>$1</i>");
  text = text.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");

  text = text.replace(/\u0002CCIMCODEBLOCK(\d+)\u0002/g, (_, i) => codeBlocks[Number(i)] || "");
  text = text.replace(/\u0003CCIMINLINECODE(\d+)\u0003/g, (_, i) => inlineCodes[Number(i)] || "");
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
