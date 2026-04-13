import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeHtmlAttribute(text: string): string {
  return escapeHtml(text).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  typographer: false,
});

const MARKER_STX = "\u0002";
const TABLE_BLOCK_MARKER_PREFIX = `${MARKER_STX}CCIMTB`;
const TABLE_BLOCK_MARKER_PATTERN = new RegExp(`${MARKER_STX}CCIMTB(\\d+)${MARKER_STX}`, "g");

export function markdownToTelegramHtml(md: string): string {
  const tableBlocks: string[] = [];
  const withTablePlaceholders = replaceMarkdownTables(md, (tableText) => {
    const listText = markdownTableToList(tableText);
    tableBlocks.push(`<pre><code>${escapeHtml(listText)}</code></pre>`);
    return `${TABLE_BLOCK_MARKER_PREFIX}${tableBlocks.length - 1}${MARKER_STX}`;
  });

  const tokens = markdown.parse(withTablePlaceholders, {});
  const rendered = trimTrailingBlockSeparators(renderBlocks(tokens));
  return rendered.replace(TABLE_BLOCK_MARKER_PATTERN, (_, index: string) => {
    return tableBlocks[Number(index)] || "";
  });
}

function renderBlocks(
  tokens: Token[],
  options: { compact?: boolean; suppressBold?: boolean } = {},
): string {
  let output = "";

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) {
      continue;
    }

    switch (token.type) {
      case "inline":
        output += renderInline(token.children ?? [], {
          suppressBold: options.suppressBold,
        });
        break;
      case "paragraph_open": {
        const { inner, nextIndex } = consumeBlockContainer(tokens, index, "paragraph_close", {
          compact: options.compact,
          suppressBold: options.suppressBold,
        });
        output += appendBlock(inner, options.compact ? "\n" : "\n\n");
        index = nextIndex;
        break;
      }
      case "heading_open": {
        const { inner, nextIndex } = consumeBlockContainer(tokens, index, "heading_close", {
          compact: options.compact,
          suppressBold: true,
        });
        output += appendBlock(`<b>${trimTrailingBlockSeparators(inner)}</b>`, "\n\n");
        index = nextIndex;
        break;
      }
      case "bullet_list_open": {
        const { inner, nextIndex } = consumeList(tokens, index, "bullet");
        output += appendBlock(inner, options.compact ? "\n" : "\n\n");
        index = nextIndex;
        break;
      }
      case "ordered_list_open": {
        const start = Number(token.attrGet("start") ?? "1");
        const { inner, nextIndex } = consumeList(tokens, index, "ordered", start);
        output += appendBlock(inner, options.compact ? "\n" : "\n\n");
        index = nextIndex;
        break;
      }
      case "blockquote_open": {
        const { inner, nextIndex } = consumeBlockContainer(tokens, index, "blockquote_close", {
          compact: false,
          suppressBold: options.suppressBold,
        });
        output += appendBlock(
          `<blockquote>${trimTrailingBlockSeparators(inner)}</blockquote>`,
          options.compact ? "\n" : "\n\n",
        );
        index = nextIndex;
        break;
      }
      case "fence":
      case "code_block":
        output += appendBlock(
          renderCodeBlock(token.content ?? ""),
          options.compact ? "\n" : "\n\n",
        );
        break;
      case "hr":
        output += appendBlock("───", options.compact ? "\n" : "\n\n");
        break;
      default:
        break;
    }
  }

  return output;
}

function consumeBlockContainer(
  tokens: Token[],
  startIndex: number,
  closeType: string,
  options: { compact?: boolean; suppressBold?: boolean } = {},
): { inner: string; nextIndex: number } {
  const innerTokens: Token[] = [];

  for (let index = startIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token?.type === closeType) {
      return {
        inner: renderBlocks(innerTokens, options),
        nextIndex: index,
      };
    }
    if (token) {
      innerTokens.push(token);
    }
  }

  return {
    inner: renderBlocks(innerTokens, options),
    nextIndex: tokens.length - 1,
  };
}

function consumeList(
  tokens: Token[],
  startIndex: number,
  kind: "bullet" | "ordered",
  orderedStart = 1,
): { inner: string; nextIndex: number } {
  const closeType = kind === "bullet" ? "bullet_list_close" : "ordered_list_close";
  const items: string[] = [];
  let itemNumber = orderedStart;

  for (let index = startIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) {
      continue;
    }
    if (token.type === closeType) {
      return {
        inner: items.join("\n"),
        nextIndex: index,
      };
    }
    if (token.type !== "list_item_open") {
      continue;
    }

    const { inner, nextIndex } = consumeBlockContainer(tokens, index, "list_item_close", {
      compact: true,
      suppressBold: false,
    });
    const prefix = kind === "ordered" ? `${itemNumber}. ` : "- ";
    items.push(prefixListItem(trimTrailingBlockSeparators(inner), prefix));
    itemNumber += 1;
    index = nextIndex;
  }

  return {
    inner: items.join("\n"),
    nextIndex: tokens.length - 1,
  };
}

function renderInline(tokens: Token[], options: { suppressBold?: boolean } = {}): string {
  let output = "";

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) {
      continue;
    }

    switch (token.type) {
      case "text":
        output += escapeHtml(token.content);
        break;
      case "softbreak":
      case "hardbreak":
        output += "\n";
        break;
      case "code_inline":
        output += `<code>${escapeHtml(token.content)}</code>`;
        break;
      case "strong_open": {
        const { inner, nextIndex } = consumeInlineContainer(tokens, index, "strong_close", options);
        output += options.suppressBold ? inner : `<b>${inner}</b>`;
        index = nextIndex;
        break;
      }
      case "em_open": {
        const { inner, nextIndex } = consumeInlineContainer(tokens, index, "em_close", options);
        output += `<i>${inner}</i>`;
        index = nextIndex;
        break;
      }
      case "s_open": {
        const { inner, nextIndex } = consumeInlineContainer(tokens, index, "s_close", options);
        output += `<s>${inner}</s>`;
        index = nextIndex;
        break;
      }
      case "link_open": {
        const { inner, nextIndex } = consumeInlineContainer(tokens, index, "link_close", options);
        const href = token.attrGet("href");
        output += href ? `<a href="${escapeHtmlAttribute(href)}">${inner}</a>` : inner;
        index = nextIndex;
        break;
      }
      case "image":
        output += escapeHtml(token.content);
        break;
      default:
        if (token.children?.length) {
          output += renderInline(token.children, options);
        }
        break;
    }
  }

  return output;
}

function consumeInlineContainer(
  tokens: Token[],
  startIndex: number,
  closeType: string,
  options: { suppressBold?: boolean },
): { inner: string; nextIndex: number } {
  const innerTokens: Token[] = [];

  for (let index = startIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token?.type === closeType) {
      return {
        inner: renderInline(innerTokens, options),
        nextIndex: index,
      };
    }
    if (token) {
      innerTokens.push(token);
    }
  }

  return {
    inner: renderInline(innerTokens, options),
    nextIndex: tokens.length - 1,
  };
}

function renderCodeBlock(content: string): string {
  const normalized = content.endsWith("\n") ? content.slice(0, -1) : content;
  return `<pre><code>${escapeHtml(normalized)}</code></pre>`;
}

function appendBlock(block: string, separator: string): string {
  if (!block) {
    return "";
  }
  return `${block}${separator}`;
}

function trimTrailingBlockSeparators(text: string): string {
  return text.replace(/\n+$/g, "");
}

function prefixListItem(text: string, prefix: string): string {
  if (!text) {
    return prefix.trimEnd();
  }

  const lines = text.split("\n");
  const [firstLine = "", ...restLines] = lines;
  const indentedRest = restLines.map((line) => (line ? `  ${line}` : line));
  return [prefix + firstLine, ...indentedRest].join("\n");
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

    output.push(lines[index] || "");
    index += 1;
  }

  return output.join("\n");
}

function isMarkdownTableHeader(lines: string[], index: number): boolean {
  if (index + 1 >= lines.length) {
    return false;
  }

  return isMarkdownTableRow(lines[index] || "") && isMarkdownTableSeparator(lines[index + 1] || "");
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

  const headers = rows[0] || [];
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
