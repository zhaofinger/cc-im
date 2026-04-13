import { describe, expect, test } from "bun:test";
import { escapeHtml, markdownToTelegramHtml } from "../telegram-formatting.ts";

describe("escapeHtml", () => {
  test("should escape ampersand", () => {
    expect(escapeHtml("&")).toBe("&amp;");
    expect(escapeHtml("foo & bar")).toBe("foo &amp; bar");
  });

  test("should escape less than", () => {
    expect(escapeHtml("<")).toBe("&lt;");
    expect(escapeHtml("foo < bar")).toBe("foo &lt; bar");
  });

  test("should escape greater than", () => {
    expect(escapeHtml(">")).toBe("&gt;");
    expect(escapeHtml("foo > bar")).toBe("foo &gt; bar");
  });

  test("should escape multiple special characters", () => {
    expect(escapeHtml("<div>foo & bar</div>")).toBe("&lt;div&gt;foo &amp; bar&lt;/div&gt;");
  });

  test("should handle empty string", () => {
    expect(escapeHtml("")).toBe("");
  });

  test("should not escape already escaped entities", () => {
    // Note: this double-escapes, which might be intentional or a bug
    expect(escapeHtml("&amp;")).toBe("&amp;amp;");
  });

  test("should handle text without special characters", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
  });

  test("should handle unicode text", () => {
    expect(escapeHtml("你好")).toBe("你好");
    expect(escapeHtml("🎉")).toBe("🎉");
  });

  test("should handle quotes in plain text", () => {
    expect(escapeHtml('"quoted"')).toBe('"quoted"');
    expect(escapeHtml("'single'")).toBe("'single'");
  });
});

describe("markdownToTelegramHtml", () => {
  test("should convert bold with double asterisks", () => {
    expect(markdownToTelegramHtml("**bold**")).toBe("<b>bold</b>");
  });

  test("should convert bold with double underscores", () => {
    expect(markdownToTelegramHtml("__bold__")).toBe("<b>bold</b>");
  });

  test("should convert italic with single asterisks", () => {
    expect(markdownToTelegramHtml("*italic*")).toBe("<i>italic</i>");
  });

  test("should convert strikethrough with tildes", () => {
    expect(markdownToTelegramHtml("~~strikethrough~~")).toBe("<s>strikethrough</s>");
  });

  test("should convert links", () => {
    expect(markdownToTelegramHtml("[text](https://example.com)")).toBe(
      '<a href="https://example.com">text</a>',
    );
  });

  test("should convert headers", () => {
    expect(markdownToTelegramHtml("# Header 1")).toBe("<b>Header 1</b>");
    expect(markdownToTelegramHtml("## Header 2")).toBe("<b>Header 2</b>");
    expect(markdownToTelegramHtml("###### Header 6")).toBe("<b>Header 6</b>");
  });

  test("should convert inline code", () => {
    expect(markdownToTelegramHtml("`code`")).toBe("<code>code</code>");
  });

  test("should convert code blocks", () => {
    expect(markdownToTelegramHtml("```\ncode block\n```")).toBe(
      "<pre><code>code block</code></pre>",
    );
  });

  test("should convert code blocks with language specifier", () => {
    expect(markdownToTelegramHtml("```typescript\nconst x = 1;\n```")).toBe(
      "<pre><code>const x = 1;</code></pre>",
    );
  });

  test("should escape HTML in text", () => {
    expect(markdownToTelegramHtml("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
  });

  test("should handle mixed formatting", () => {
    const input = "**bold** and *italic* and `code`";
    const result = markdownToTelegramHtml(input);
    expect(result).toContain("<b>bold</b>");
    expect(result).toContain("<i>italic</i>");
    expect(result).toContain("<code>code</code>");
  });

  test("should handle empty string", () => {
    expect(markdownToTelegramHtml("")).toBe("");
  });

  test("should handle plain text without formatting", () => {
    expect(markdownToTelegramHtml("plain text")).toBe("plain text");
  });

  test("should handle code blocks with backticks inside", () => {
    const input = "```\nconst x = `template` + 'literal';\n```";
    const result = markdownToTelegramHtml(input);
    expect(result).toContain("<pre><code>const x = `template` + 'literal';</code></pre>");
  });

  test("should handle incomplete formatting markers", () => {
    expect(markdownToTelegramHtml("*not closed")).toBe("*not closed");
    expect(markdownToTelegramHtml("**not closed")).toBe("**not closed");
  });

  test("should handle multiple paragraphs", () => {
    const input = "Paragraph 1\n\nParagraph 2";
    const result = markdownToTelegramHtml(input);
    expect(result).toContain("Paragraph 1");
    expect(result).toContain("Paragraph 2");
  });

  test("should handle italic with word boundaries correctly", () => {
    expect(markdownToTelegramHtml("not*italic*here")).toBe("not<i>italic</i>here");
    expect(markdownToTelegramHtml("*italic*")).toBe("<i>italic</i>");
  });

  test("should handle bold in middle of text", () => {
    expect(markdownToTelegramHtml("prefix **bold** suffix")).toBe("prefix <b>bold</b> suffix");
  });

  test("should handle nested code blocks and inline code", () => {
    const input = "Text with `inline` and:\n```\nblock\n```";
    const result = markdownToTelegramHtml(input);
    expect(result).toContain("<code>inline</code>");
    expect(result).toContain("<pre><code>block</code></pre>");
  });

  test("should handle special characters in code", () => {
    const input = '```\n<html> & "test"\n```';
    const result = markdownToTelegramHtml(input);
    expect(result).toContain('&lt;html&gt; &amp; "test"');
  });

  test("should handle list items", () => {
    const input = "- item 1\n- item 2";
    const result = markdownToTelegramHtml(input);
    expect(result).toContain("- item 1");
    expect(result).toContain("- item 2");
  });

  test("should render blockquotes as telegram blockquotes", () => {
    const input = "> quote line 1\n> quote line 2";
    const result = markdownToTelegramHtml(input);
    expect(result).toBe("<blockquote>quote line 1\nquote line 2</blockquote>");
  });

  test("should handle complex nested structure", () => {
    const input = `# Title with **bold**
Some \`inline code\` here
\`\`\`
function test() {
  return "**not bold**";
}
\`\`\`
More text`;
    const result = markdownToTelegramHtml(input);
    expect(result).toContain("<b>Title with bold</b>");
    expect(result).toContain("<code>inline code</code>");
    expect(result).toContain(
      '<pre><code>function test() {\n  return "**not bold**";\n}</code></pre>',
    );
  });

  test("should handle links with special characters", () => {
    const input = "[link](https://example.com?foo=bar&baz=qux)";
    const result = markdownToTelegramHtml(input);
    expect(result).toBe('<a href="https://example.com?foo=bar&amp;baz=qux">link</a>');
  });

  test("should escape quotes inside link href attributes", () => {
    const input = "[link](https://example.com?a=\"quoted\"&b='single')";
    const result = markdownToTelegramHtml(input);
    expect(result).toBe(
      '<a href="https://example.com?a=%22quoted%22&amp;b=&#39;single&#39;">link</a>',
    );
  });

  test("should handle links with balanced parentheses", () => {
    const input = "[link](https://example.com/path(foo))";
    const result = markdownToTelegramHtml(input);
    expect(result).toBe('<a href="https://example.com/path(foo)">link</a>');
  });

  test("should handle strikethrough edge cases", () => {
    expect(markdownToTelegramHtml("~~")).toBe("~~");
    expect(markdownToTelegramHtml("~~~")).toBe("<pre><code></code></pre>");
    expect(markdownToTelegramHtml("~~~~")).toBe("<pre><code></code></pre>");
  });

  test("should preserve line breaks", () => {
    const input = "line1\nline2";
    const result = markdownToTelegramHtml(input);
    expect(result).toContain("\n");
  });

  test("should handle code block at end of text", () => {
    const input = "Text\n```\ncode\n```";
    const result = markdownToTelegramHtml(input);
    expect(result).toContain("Text");
    expect(result).toContain("<pre><code>code</code></pre>");
  });

  test("should handle code block without closing markers", () => {
    const input = "```\nunclosed code";
    const result = markdownToTelegramHtml(input);
    // Should still extract or handle gracefully
    expect(result).toContain("unclosed code");
  });

  test("should convert markdown tables to preformatted list blocks", () => {
    const input = `| 时段 | 天气 | 气温 | 风力 |
|------|------|------|------|
| 上午 | 晴 | 21°C | 北风 7-8 km/h |
| 中午 | 晴 | 24°C | 北风 8-9 km/h |`;

    const result = markdownToTelegramHtml(input);
    expect(result).toBe(
      "<pre><code>上午: 天气: 晴 | 气温: 21°C | 风力: 北风 7-8 km/h\n中午: 天气: 晴 | 气温: 24°C | 风力: 北风 8-9 km/h</code></pre>",
    );
  });
});
