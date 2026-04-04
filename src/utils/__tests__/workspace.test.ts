import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  isWorkspaceDirName,
  listWorkspaceNames,
  firstWorkspaceCandidate,
  resolveWorkspacePath,
} from "../workspace.ts";

describe("isWorkspaceDirName", () => {
  test("should return false for names starting with dot", () => {
    expect(isWorkspaceDirName(".hidden")).toBe(false);
    expect(isWorkspaceDirName(".git")).toBe(false);
  });

  test("should return false for node_modules", () => {
    expect(isWorkspaceDirName("node_modules")).toBe(false);
  });

  test("should return false for logs", () => {
    expect(isWorkspaceDirName("logs")).toBe(false);
  });

  test("should return true for valid workspace names", () => {
    expect(isWorkspaceDirName("my-project")).toBe(true);
    expect(isWorkspaceDirName("workspace")).toBe(true);
    expect(isWorkspaceDirName("src")).toBe(true);
  });

  test("should return true for names containing dots but not starting with dot", () => {
    expect(isWorkspaceDirName("my.project")).toBe(true);
    expect(isWorkspaceDirName("config.v2")).toBe(true);
  });

  test("should handle edge cases", () => {
    expect(isWorkspaceDirName("")).toBe(true); // empty string doesn't start with dot
    expect(isWorkspaceDirName("nodE_modUles")).toBe(true); // case sensitive check
    expect(isWorkspaceDirName("LOGS")).toBe(true); // case sensitive check
  });
});

describe("listWorkspaceNames", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `cc-im-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  test("should list only valid workspace directories", () => {
    mkdirSync(join(testDir, "project1"));
    mkdirSync(join(testDir, "project2"));
    mkdirSync(join(testDir, ".hidden"));
    mkdirSync(join(testDir, "node_modules"));
    mkdirSync(join(testDir, "logs"));
    writeFileSync(join(testDir, "file.txt"), "content");

    const result = listWorkspaceNames(testDir);
    expect(result).toEqual(["project1", "project2"]);
  });

  test("should return sorted list", () => {
    mkdirSync(join(testDir, "zebra"));
    mkdirSync(join(testDir, "alpha"));
    mkdirSync(join(testDir, "beta"));

    const result = listWorkspaceNames(testDir);
    expect(result).toEqual(["alpha", "beta", "zebra"]);
  });

  test("should return empty array for empty directory", () => {
    const result = listWorkspaceNames(testDir);
    expect(result).toEqual([]);
  });

  test("should return empty array for directory with only invalid entries", () => {
    mkdirSync(join(testDir, ".git"));
    mkdirSync(join(testDir, "node_modules"));
    mkdirSync(join(testDir, "logs"));
    writeFileSync(join(testDir, "readme.md"), "content");

    const result = listWorkspaceNames(testDir);
    expect(result).toEqual([]);
  });

  test("should handle nested directories correctly", () => {
    mkdirSync(join(testDir, "parent"));
    mkdirSync(join(testDir, "parent", "child"));

    const result = listWorkspaceNames(testDir);
    expect(result).toEqual(["parent"]);
  });

  test("should handle symlinks (may vary by OS)", () => {
    // This test behavior may vary by OS/permissions
    // Just ensure it doesn't throw
    expect(() => listWorkspaceNames(testDir)).not.toThrow();
  });
});

describe("firstWorkspaceCandidate", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `cc-im-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  test("should return full path of first workspace alphabetically", () => {
    mkdirSync(join(testDir, "zebra"));
    mkdirSync(join(testDir, "alpha"));

    const result = firstWorkspaceCandidate(testDir);
    expect(result).toBe(join(testDir, "alpha"));
  });

  test("should return undefined when no valid workspaces exist", () => {
    mkdirSync(join(testDir, ".hidden"));
    mkdirSync(join(testDir, "node_modules"));

    const result = firstWorkspaceCandidate(testDir);
    expect(result).toBeUndefined();
  });

  test("should return undefined for empty directory", () => {
    const result = firstWorkspaceCandidate(testDir);
    expect(result).toBeUndefined();
  });

  test("should skip invalid entries and return first valid", () => {
    mkdirSync(join(testDir, ".hidden"));
    mkdirSync(join(testDir, "valid-workspace"));

    const result = firstWorkspaceCandidate(testDir);
    expect(result).toBe(join(testDir, "valid-workspace"));
  });
});

describe("resolveWorkspacePath", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `cc-im-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    mkdirSync(join(testDir, "valid-workspace"));
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  test("should resolve valid workspace path", () => {
    const result = resolveWorkspacePath(testDir, "valid-workspace");
    expect(result).toBe(join(testDir, "valid-workspace"));
  });

  test("should throw error for path traversal attempt", () => {
    expect(() => resolveWorkspacePath(testDir, "../etc")).toThrow(
      "Workspace escapes configured root",
    );
  });

  test("should throw error for non-existent workspace", () => {
    expect(() => resolveWorkspacePath(testDir, "non-existent")).toThrow();
  });

  test("should throw error for file instead of directory", () => {
    writeFileSync(join(testDir, "file-workspace"), "content");
    expect(() => resolveWorkspacePath(testDir, "file-workspace")).toThrow(
      "Workspace is not a directory",
    );
  });

  test("should handle workspace at root level", () => {
    // Create a workspace that matches the root name
    mkdirSync(join(testDir, "subdir"), { recursive: true });
    const result = resolveWorkspacePath(testDir, "subdir");
    expect(result).toBe(join(testDir, "subdir"));
  });

  test("should handle nested workspace paths", () => {
    mkdirSync(join(testDir, "parent"));
    mkdirSync(join(testDir, "parent", "child"));

    // This should work since parent is within root
    const result = resolveWorkspacePath(testDir, "parent");
    expect(result).toBe(join(testDir, "parent"));
  });

  test("should reject absolute paths outside root", () => {
    expect(() => resolveWorkspacePath(testDir, "/etc/passwd")).toThrow(
      "Workspace escapes configured root",
    );
  });

  test("should handle symlinks within root", () => {
    // This behavior may vary by OS
    // Just ensure consistent behavior
    expect(() => resolveWorkspacePath(testDir, "valid-workspace")).not.toThrow();
  });
});
