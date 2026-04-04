import { describe, expect, test } from "bun:test";
import { chunk } from "../array.ts";

describe("chunk", () => {
  test("should split array into chunks of specified size", () => {
    const result = chunk([1, 2, 3, 4, 5, 6], 2);
    expect(result).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
    ]);
  });

  test("should handle array with elements not evenly divisible by size", () => {
    const result = chunk([1, 2, 3, 4, 5], 2);
    expect(result).toEqual([[1, 2], [3, 4], [5]]);
  });

  test("should return empty array for empty input", () => {
    const result = chunk([], 3);
    expect(result).toEqual([]);
  });

  test("should handle single element array", () => {
    const result = chunk(["a"], 2);
    expect(result).toEqual([["a"]]);
  });

  test("should handle chunk size larger than array", () => {
    const result = chunk([1, 2], 5);
    expect(result).toEqual([[1, 2]]);
  });

  test("should handle chunk size of 1", () => {
    const result = chunk(["a", "b", "c"], 1);
    expect(result).toEqual([["a"], ["b"], ["c"]]);
  });

  test("should handle arrays with mixed types", () => {
    const result = chunk([1, "a", true, null, undefined], 2);
    expect(result).toEqual([[1, "a"], [true, null], [undefined]]);
  });

  test("should not mutate original array", () => {
    const original = [1, 2, 3, 4];
    const result = chunk(original, 2);
    expect(original).toEqual([1, 2, 3, 4]);
    expect(result).not.toBe(original);
  });

  test("should return new array instances for each chunk", () => {
    const result = chunk([1, 2, 3, 4], 2);
    expect(result[0]).not.toBe(result[1]);
  });
});
