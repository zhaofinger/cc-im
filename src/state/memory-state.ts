import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  ChatState,
  PendingApproval,
  PersistedChatSelection,
  WorkspaceSession,
} from "../types.ts";

export class MemoryState {
  private chatState?: ChatState;
  private readonly workspaceSessions = new Map<string, WorkspaceSession>();
  private saveTimeout?: ReturnType<typeof setTimeout>;

  constructor(private readonly stateFile: string) {}

  getChatState(chatId: number): ChatState {
    if (!this.chatState) {
      this.chatState = this.loadSelection(chatId) || {
        chatId,
        status: "idle",
      };
    }
    if (this.chatState.chatId !== chatId) {
      throw new Error("This build supports a single active chat only");
    }
    return this.chatState;
  }

  setSelectedWorkspace(chatId: number, workspacePath: string, workspaceName: string): ChatState {
    const state = this.getChatState(chatId);
    state.selectedWorkspace = workspacePath;
    state.selectedWorkspaceName = workspaceName;
    this.scheduleSave(state);
    return state;
  }

  setActiveRun(chatId: number, runId?: string, status: ChatState["status"] = "idle"): ChatState {
    const state = this.getChatState(chatId);
    state.activeRunId = runId;
    state.status = status;
    if (!runId) {
      state.pendingApproval = undefined;
    }
    return state;
  }

  setPendingApproval(chatId: number, approval?: PendingApproval): ChatState {
    const state = this.getChatState(chatId);
    state.pendingApproval = approval;
    state.status = approval ? "awaiting_approval" : state.activeRunId ? "running" : "idle";
    return state;
  }

  getWorkspaceSession(workspacePath: string): WorkspaceSession | undefined {
    return this.workspaceSessions.get(workspacePath);
  }

  setWorkspaceSession(session: WorkspaceSession): WorkspaceSession {
    this.workspaceSessions.set(session.workspacePath, session);
    return session;
  }

  allWorkspaceSessions(): WorkspaceSession[] {
    return [...this.workspaceSessions.values()];
  }

  private scheduleSave(state: ChatState): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => {
      this.saveTimeout = undefined;
      this.saveSelection(state);
    }, 100);
  }

  private loadSelection(chatId: number): ChatState | undefined {
    try {
      const raw = readFileSync(this.stateFile, "utf8");
      const parsed = JSON.parse(raw) as PersistedChatSelection;
      if (parsed.chatId !== chatId) {
        return undefined;
      }
      return {
        chatId,
        selectedWorkspace: parsed.selectedWorkspace,
        selectedWorkspaceName: parsed.selectedWorkspaceName,
        status: "idle",
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      return undefined;
    }
  }

  private saveSelection(state: ChatState): void {
    const payload: PersistedChatSelection = {
      chatId: state.chatId,
      selectedWorkspace: state.selectedWorkspace,
      selectedWorkspaceName: state.selectedWorkspaceName,
    };
    mkdirSync(dirname(this.stateFile), { recursive: true });
    writeFileSync(this.stateFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }
}
