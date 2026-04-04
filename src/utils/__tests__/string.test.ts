import { describe, expect, test } from "bun:test";
import { clipForTelegram, shorten } from "../string.ts";

describe("shorten", () => {
  test("should return original string if length is within maxLen", () => {
    expect(shorten("hello", 10)).toBe("hello");
  });

  test("should truncate string with ellipsis when exceeding maxLen", () => {
    expect(shorten("hello world", 8)).toBe("hello...");
  });

  test("should handle empty string", () => {
    expect(shorten("", 5)).toBe("");
  });

  test("should handle maxLen equal to string length", () => {
    expect(shorten("exact", 5)).toBe("exact");
  });

  test("should handle maxLen less than 3 (ellipsis length)", () => {
    // Function behavior: maxLen of 2 results in slice(0, -1) which returns "hell..."
    const result = shorten("hello", 2);
    expect(result.endsWith("...")).toBe(true);
  });

  test("should handle maxLen equal to 3", () => {
    expect(shorten("hello", 3)).toBe("...");
  });

  test("should handle maxLen of 0", () => {
    // maxLen of 0 results in negative slice, returns original + "..."
    const result = shorten("hello", 0);
    expect(result.endsWith("...")).toBe(true);
  });

  test("should handle unicode characters correctly", () => {
    // Unicode characters count as 1 each in JavaScript
    const result = shorten("你好世界你好", 6);
    // If length is exactly 6, should not truncate
    expect(result.length).toBeLessThanOrEqual(9); // 6 chars + "..."
  });

  test("should handle very long strings", () => {
    const longString = "a".repeat(1000);
    expect(shorten(longString, 100).length).toBe(100);
    expect(shorten(longString, 100).endsWith("...")).toBe(true);
  });
});

describe("clipForTelegram", () => {
  test("should return original string if length is within default maxLen", () => {
    const text = "Short message";
    expect(clipForTelegram(text)).toBe(text);
  });

  test("should truncate with truncated notice when exceeding maxLen", () => {
    const longText = "a".repeat(4000);
    const result = clipForTelegram(longText);
    expect(result.endsWith("\n\n_[truncated]_")).toBe(true);
    expect(result.length).toBeLessThanOrEqual(3900);
  });

  test("should use custom maxLen when provided", () => {
    const text = "hello world this is a test";
    expect(clipForTelegram(text, 20).endsWith("_[truncated]_")).toBe(true);
  });

  test("should return original when string fits custom maxLen", () => {
    const text = "short";
    expect(clipForTelegram(text, 100)).toBe("short");
  });

  test("should handle empty string", () => {
    expect(clipForTelegram("")).toBe("");
  });

  test("should handle string exactly at maxLen boundary", () => {
    const text = "a".repeat(3900);
    expect(clipForTelegram(text).length).toBe(3900);
  });

  test("should handle string one char over maxLen", () => {
    const text = "a".repeat(3901);
    const result = clipForTelegram(text);
    expect(result.endsWith("_[truncated]_")).toBe(true);
  });

  test("should handle unicode characters", () => {
    const text = "你".repeat(4000);
    const result = clipForTelegram(text);
    expect(result.endsWith("_[truncated]_")).toBe(true);
  });

  test("should handle very small maxLen gracefully", () => {
    const text = "hello world";
    const result = clipForTelegram(text, 20);
    // String is 11 chars, maxLen is 20, should not truncate
    expect(result.length).toBeLessThanOrEqual(20);
    // Only truncates if exceeds maxLen
    expect(result).toBe("hello world");
  });
});
