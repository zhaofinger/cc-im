import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryState } from "../memory-state.ts";

describe("MemoryState", () => {
  let testDir: string;
  let stateFile: string;
  let memoryState: MemoryState;

  beforeEach(() => {
    testDir = join(tmpdir(), `cc-im-state-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    stateFile = join(testDir, "state.json");
    memoryState = new MemoryState(stateFile);
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  describe("getChatState", () => {
    test("should create new chat state if none exists", () => {
      const state = memoryState.getChatState(123456);
      expect(state.chatId).toBe(123456);
      expect(state.status).toBe("idle");
      expect(state.selectedWorkspace).toBeUndefined();
    });

    test("should return same chat state for same chatId", () => {
      const state1 = memoryState.getChatState(123456);
      const state2 = memoryState.getChatState(123456);
      expect(state1).toBe(state2);
    });

    test("should throw error for different chatId", () => {
      memoryState.getChatState(123456);
      expect(() => memoryState.getChatState(789012)).toThrow("This build supports a single active chat only");
    });

    test("should load from file if exists", () => {
      writeFileSync(stateFile, JSON.stringify({
        chatId: 123456,
        selectedWorkspace: "/path/to/workspace",
        selectedWorkspaceName: "my-workspace"
      }));

      const memoryState2 = new MemoryState(stateFile);
      const state = memoryState2.getChatState(123456);
      expect(state.selectedWorkspace).toBe("/path/to/workspace");
      expect(state.selectedWorkspaceName).toBe("my-workspace");
    });

    test("should ignore file if chatId doesn't match", () => {
      writeFileSync(stateFile, JSON.stringify({
        chatId: 999999,
        selectedWorkspace: "/path/to/workspace"
      }));

      const memoryState2 = new MemoryState(stateFile);
      const state = memoryState2.getChatState(123456);
      expect(state.selectedWorkspace).toBeUndefined();
    });

    test("should handle corrupted file gracefully", () => {
      writeFileSync(stateFile, "not valid json");

      const memoryState2 = new MemoryState(stateFile);
      const state = memoryState2.getChatState(123456);
      expect(state.status).toBe("idle");
    });

    test("should handle missing file gracefully", () => {
      const memoryState2 = new MemoryState(join(testDir, "non-existent.json"));
      const state = memoryState2.getChatState(123456);
      expect(state.status).toBe("idle");
    });
  });

  describe("setSelectedWorkspace", () => {
    test("should set selected workspace", () => {
      const state = memoryState.setSelectedWorkspace(123456, "/workspace", "my-workspace");
      expect(state.selectedWorkspace).toBe("/workspace");
      expect(state.selectedWorkspaceName).toBe("my-workspace");
    });

    test("should persist to file", async () => {
      memoryState.setSelectedWorkspace(123456, "/workspace", "my-workspace");

      // Wait for debounced save
      await new Promise((resolve) => setTimeout(resolve, 200));

      const content = readFileSync(stateFile, "utf8");
      const saved = JSON.parse(content);
      expect(saved.selectedWorkspace).toBe("/workspace");
      expect(saved.selectedWorkspaceName).toBe("my-workspace");
    });

    test("should debounce multiple saves", async () => {
      memoryState.setSelectedWorkspace(123456, "/workspace1", "ws1");
      memoryState.setSelectedWorkspace(123456, "/workspace2", "ws2");
      memoryState.setSelectedWorkspace(123456, "/workspace3", "ws3");

      // Wait for debounced save
      await new Promise((resolve) => setTimeout(resolve, 200));

      const content = readFileSync(stateFile, "utf8");
      const saved = JSON.parse(content);
      expect(saved.selectedWorkspace).toBe("/workspace3");
    });
  });

  describe("setActiveRun", () => {
    test("should set active run", () => {
      const state = memoryState.setActiveRun(123456, "run-123", "running");
      expect(state.activeRunId).toBe("run-123");
      expect(state.status).toBe("running");
    });

    test("should clear pending approval when clearing run", () => {
      memoryState.setActiveRun(123456, "run-123", "running");
      memoryState.setPendingApproval(123456, {
        id: "approval-1",
        runId: "run-123",
        summary: "test",
        createdAt: Date.now()
      });

      const state = memoryState.setActiveRun(123456);
      expect(state.activeRunId).toBeUndefined();
      expect(state.pendingApproval).toBeUndefined();
      expect(state.status).toBe("idle");
    });

    test("should allow status without runId", () => {
      const state = memoryState.setActiveRun(123456, undefined, "idle");
      expect(state.activeRunId).toBeUndefined();
      expect(state.status).toBe("idle");
    });
  });

  describe("setPendingApproval", () => {
    test("should set pending approval", () => {
      const approval = {
        id: "approval-1",
        runId: "run-123",
        summary: "test approval",
        createdAt: Date.now()
      };
      const state = memoryState.setPendingApproval(123456, approval);
      expect(state.pendingApproval).toBe(approval);
      expect(state.status).toBe("awaiting_approval");
    });

    test("should clear pending approval", () => {
      memoryState.setPendingApproval(123456, {
        id: "approval-1",
        runId: "run-123",
        summary: "test",
        createdAt: Date.now()
      });

      const state = memoryState.setPendingApproval(123456, undefined);
      expect(state.pendingApproval).toBeUndefined();
      expect(state.status).toBe("idle");
    });

    test("should maintain running status when clearing approval with active run", () => {
      memoryState.setActiveRun(123456, "run-123", "running");
      memoryState.setPendingApproval(123456, {
        id: "approval-1",
        runId: "run-123",
        summary: "test",
        createdAt: Date.now()
      });

      const state = memoryState.setPendingApproval(123456, undefined);
      expect(state.status).toBe("running");
    });

    test("should store resolve function", () => {
      const resolveFn = (decision: "approve" | "reject") => {};
      const approval = {
        id: "approval-1",
        runId: "run-123",
        summary: "test",
        createdAt: Date.now(),
        resolve: resolveFn
      };
      const state = memoryState.setPendingApproval(123456, approval);
      expect(state.pendingApproval?.resolve).toBe(resolveFn);
    });
  });

  describe("getWorkspaceSession", () => {
    test("should return undefined for unknown workspace", () => {
      const session = memoryState.getWorkspaceSession("/unknown/workspace");
      expect(session).toBeUndefined();
    });

    test("should return session after setting", () => {
      memoryState.setWorkspaceSession({
        workspacePath: "/workspace1",
        workspaceName: "ws1",
        sessionId: "session-123",
        slashCommands: ["/commit", "/status"],
        lastTouchedAt: Date.now()
      });

      const session = memoryState.getWorkspaceSession("/workspace1");
      expect(session).toBeDefined();
      expect(session?.workspaceName).toBe("ws1");
      expect(session?.sessionId).toBe("session-123");
    });
  });

  describe("setWorkspaceSession", () => {
    test("should set workspace session", () => {
      const session = memoryState.setWorkspaceSession({
        workspacePath: "/workspace1",
        workspaceName: "ws1",
        sessionId: "session-123",
        slashCommands: ["/commit"],
        lastTouchedAt: 1234567890
      });

      expect(session.workspacePath).toBe("/workspace1");
      expect(session.slashCommands).toEqual(["/commit"]);
    });

    test("should update existing session", () => {
      memoryState.setWorkspaceSession({
        workspacePath: "/workspace1",
        workspaceName: "ws1",
        sessionId: "session-123",
        slashCommands: ["/commit"],
        lastTouchedAt: 1234567890
      });

      const updated = memoryState.setWorkspaceSession({
        workspacePath: "/workspace1",
        workspaceName: "ws1-renamed",
        sessionId: "session-456",
        slashCommands: ["/commit", "/status"],
        lastTouchedAt: 9876543210
      });

      expect(updated.workspaceName).toBe("ws1-renamed");
      expect(updated.sessionId).toBe("session-456");

      const retrieved = memoryState.getWorkspaceSession("/workspace1");
      expect(retrieved?.sessionId).toBe("session-456");
    });

    test("should support multiple workspaces", () => {
      memoryState.setWorkspaceSession({
        workspacePath: "/workspace1",
        workspaceName: "ws1",
        sessionId: "session-1",
        slashCommands: [],
        lastTouchedAt: Date.now()
      });

      memoryState.setWorkspaceSession({
        workspacePath: "/workspace2",
        workspaceName: "ws2",
        sessionId: "session-2",
        slashCommands: [],
        lastTouchedAt: Date.now()
      });

      expect(memoryState.getWorkspaceSession("/workspace1")?.sessionId).toBe("session-1");
      expect(memoryState.getWorkspaceSession("/workspace2")?.sessionId).toBe("session-2");
    });
  });

  describe("allWorkspaceSessions", () => {
    test("should return empty array initially", () => {
      expect(memoryState.allWorkspaceSessions()).toEqual([]);
    });

    test("should return all sessions", () => {
      memoryState.setWorkspaceSession({
        workspacePath: "/workspace1",
        workspaceName: "ws1",
        sessionId: "session-1",
        slashCommands: [],
        lastTouchedAt: 1000
      });

      memoryState.setWorkspaceSession({
        workspacePath: "/workspace2",
        workspaceName: "ws2",
        sessionId: "session-2",
        slashCommands: [],
        lastTouchedAt: 2000
      });

      const sessions = memoryState.allWorkspaceSessions();
      expect(sessions.length).toBe(2);
      expect(sessions.map(s => s.workspaceName)).toContain("ws1");
      expect(sessions.map(s => s.workspaceName)).toContain("ws2");
    });

    test("should return new array each time", () => {
      memoryState.setWorkspaceSession({
        workspacePath: "/workspace1",
        workspaceName: "ws1",
        sessionId: "session-1",
        slashCommands: [],
        lastTouchedAt: Date.now()
      });

      const sessions1 = memoryState.allWorkspaceSessions();
      const sessions2 = memoryState.allWorkspaceSessions();
      expect(sessions1).not.toBe(sessions2);
      expect(sessions1).toEqual(sessions2);
    });
  });
});
