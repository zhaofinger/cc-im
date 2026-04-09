import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { FormattedString, fmt } from "@grammyjs/parse-mode";
import type { AppConfig } from "../config.ts";
import type { AgentAdapter } from "../agent/types.ts";
import type { Logger } from "../logger.ts";
import { MemoryState } from "../state/memory-state.ts";
import { TelegramApi } from "../telegram/api.ts";
import {
  buildApprovalMenu,
  buildClaudeCommandsMenu,
  buildModeMenu,
  buildWorkspaceMenu,
} from "../telegram/menus.ts";
import type {
  AppCallback,
  AppMessage,
  ApprovalDecision,
  ApprovalRequest,
  ClaudeEvent,
  PermissionMode,
} from "../types.ts";
import { markdownToTelegramHtml } from "../utils/telegram-formatting.ts";
import { escapeHtml } from "../utils/telegram-formatting.ts";
import { clipForTelegram } from "../utils/string.ts";
import { listWorkspaceNames, resolveWorkspacePath } from "../utils/workspace.ts";

async function spawnAsync(cmd: string[]): Promise<{ exitCode: number; stdout: string }> {
  const proc = Bun.spawn({
    cmd,
    stdout: "pipe",
    stderr: "ignore",
  });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return { exitCode, stdout };
}

type ToolCall = {
  id: string;
  name: string;
  status: "pending" | "running" | "completed" | "failed";
  input?: string;
  result?: string;
  duration?: number;
  startedAt: number;
  completedAt?: number;
};

type ActiveRunRecord = {
  runId: string;
  progressMessageId: number;
  stop: () => void;
  contentDraftId: number;
  accumulatedText: string;
  lastFlushedText: string;
  progressText: string;
  phase: string;
  currentTool?: string;
  approvalState?: string;
  lastProgressFlushedText: string;
  flushTimer?: Timer;
  progressFlushTimer?: Timer;
  typingTimer?: Timer;
  progressUpdateInFlight?: boolean;
  progressRateLimitedUntil?: number;
  lastProgressSentAt?: number;
  sessionId: string;
  workspacePath: string;
  workspaceName: string;
  workspaceStatusLine: string;
  permissionMode: PermissionMode;
  toolCalls: ToolCall[];
  currentToolCall?: ToolCall;
  startTime: number;
};

const PHASE_BADGES: Record<string, string> = {
  thinking: "🤔",
  ready: "✅",
  "using tool": "🔧",
  "processing result": "📊",
  completed: "🎉",
  failed: "❌",
  starting: "🚀",
};

const SPINNER_CHARS = ["·", "✢", "*", "✶", "✻", "✽", "✽", "✻", "✶", "*", "✢", "·"] as const;

const TOOL_SPINNER_CHARS = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧"] as const;

const TOOL_STATUS_LABELS = {
  RUNNING: "正在执行",
  COMPLETED: "completed",
  FAILED: "failed",
} as const;

const PROGRESS_PREFIXES = {
  PHASE: "phase:",
  APPROVAL: "approval:",
  TOOL_START: "tool:start:",
  TOOL_END: "tool:end:",
  TOOL_RESULT: "Tool result: ",
  THINKING: "Thinking...",
  SESSION_READY: "Claude session ready:",
  COMMAND_OUTPUT: "Command output: ",
  CLAUDE_STATUS: "Claude status: ",
  EVENT: "event:",
} as const;

export class Bridge {
  private readonly state: MemoryState;
  private readonly activeRuns = new Map<number, ActiveRunRecord>();

  constructor(
    private readonly config: AppConfig,
    private readonly telegram: TelegramApi,
    private readonly agent: AgentAdapter,
    private readonly logger: Logger,
  ) {
    this.state = new MemoryState(
      resolve(config.logDir, "chat-selection.json"),
      config.claudeDefaultPermissionMode,
    );
  }

  async setup(): Promise<void> {
    await this.telegram.setMyCommands([
      { command: "start", description: "ℹ️ Show help" },
      { command: "workspace", description: "📁 Choose a workspace" },
      { command: "mode", description: "🛂 Choose permission mode" },
      { command: "status", description: "📊 Show current status" },
      { command: "stop", description: "⏹️ Stop the active run" },
      { command: "cc", description: "🤖 Open Claude command menu" },
    ]);
  }

  async handleMessage(message: AppMessage): Promise<void> {
    const chatId = message.chatId;
    if (!this.isAllowedChat(chatId)) {
      await this.telegram.sendMessage(chatId, "This bot is not enabled for this chat.");
      return;
    }

    const text = (message.text || "").trim();
    if (!text) {
      return;
    }

    const state = this.state.getChatState(chatId);

    if (state.pendingInputEdit && !text.startsWith("/")) {
      await this.handleApprovalInputEdit(chatId, text);
      return;
    }

    if (text === "/start") {
      await this.telegram.sendMessage(
        chatId,
        fmt`${FormattedString.bold("cc-im")}

${FormattedString.bold("Commands")}
${FormattedString.code("/workspace")} - choose a workspace
${FormattedString.code("/mode")} - choose Claude permission mode
${FormattedString.code("/status")} - show current status
${FormattedString.code("/stop")} - stop the current run
${FormattedString.code("/cc")} - show Claude slash commands

All other text is forwarded to Claude Code.
`,
      );
      return;
    }

    if (text === "/workspace") {
      await this.showWorkspaceMenu(chatId);
      return;
    }

    if (text === "/status") {
      await this.showStatus(chatId);
      return;
    }

    if (text === "/mode") {
      await this.showModeMenu(chatId);
      return;
    }

    if (text === "/stop") {
      await this.stopRun(chatId);
      return;
    }

    if (text === "/cc") {
      await this.showClaudeMenu(chatId, 0);
      return;
    }

    await this.forwardToClaude(chatId, text, message.updateId);
  }

  async handleCallback(callback: AppCallback): Promise<void> {
    const chatId = callback.chatId;
    const data = callback.data;

    await this.telegram.answerCallbackQuery(callback.id);

    if (data === "noop") {
      return;
    }

    if (data.startsWith("ws:")) {
      const workspaceName = data.slice(3);
      await this.selectWorkspace(chatId, workspaceName);
      return;
    }

    if (data.startsWith("ccpage:")) {
      const page = Number(data.slice(7));
      await this.showClaudeMenu(chatId, Number.isNaN(page) ? 0 : page, callback.messageId);
      return;
    }

    if (data.startsWith("ccrun:")) {
      const command = data.slice(6);
      await this.forwardToClaude(chatId, `/${command}`, callback.messageId);
      return;
    }

    if (data.startsWith("approve:")) {
      await this.resolveApproval(chatId, data.slice(8), { type: "approve" });
      return;
    }

    if (data.startsWith("edit:")) {
      await this.promptApprovalInputEdit(chatId, data.slice(5));
      return;
    }

    if (data.startsWith("reject:")) {
      await this.resolveApproval(chatId, data.slice(7), { type: "reject" });
      return;
    }

    if (data.startsWith("mode:")) {
      await this.selectPermissionMode(chatId, data.slice(5) as PermissionMode);
      return;
    }
  }

  private async showWorkspaceMenu(chatId: number): Promise<void> {
    const workspaces = listWorkspaceNames(this.config.workspaceRoot);
    if (workspaces.length === 0) {
      await this.telegram.sendMessage(
        chatId,
        `No workspaces found under ${this.config.workspaceRoot}.`,
      );
      return;
    }
    await this.telegram.sendMessage(chatId, "Choose a workspace:", buildWorkspaceMenu(workspaces));
  }

  private async selectWorkspace(chatId: number, workspaceName: string): Promise<void> {
    const workspacePath = resolveWorkspacePath(this.config.workspaceRoot, workspaceName);
    this.state.setSelectedWorkspace(chatId, workspacePath, workspaceName);

    const existingSession = this.state.getWorkspaceSession(workspacePath);
    const session =
      existingSession ||
      this.state.setWorkspaceSession({
        workspaceName,
        workspacePath,
        sessionId: "",
        slashCommands: [],
        lastTouchedAt: Date.now(),
      });

    const workspaceStatusLine = await this.describeWorkspaceStatus(workspacePath, workspaceName);
    await this.telegram.sendMessage(
      chatId,
      this.renderStatusCard({
        title: "<b>✅ Claude Code</b>",
        workspaceStatusLine,
        sessionId: session.sessionId,
        sections: [{ heading: "State", body: "<blockquote>workspace selected</blockquote>" }],
      }),
      { parseMode: "HTML" },
    );
  }

  private async showStatus(chatId: number): Promise<void> {
    const state = this.state.getChatState(chatId);
    const session = state.selectedWorkspace
      ? this.state.getWorkspaceSession(state.selectedWorkspace)
      : undefined;

    // Get workspace status line if workspace is selected
    let workspaceStatusLine = "no workspace";
    if (state.selectedWorkspace && state.selectedWorkspaceName) {
      workspaceStatusLine = await this.describeWorkspaceStatus(
        state.selectedWorkspace,
        state.selectedWorkspaceName,
      );
    }

    const sections: Array<{ heading: string; body: string }> = [];

    sections.push({
      heading: "Mode",
      body: `<blockquote>${escapeHtml(this.renderPermissionModeLabel(state.permissionMode))}</blockquote>`,
    });

    if (state.status !== "idle" || state.activeRunId) {
      sections.push({
        heading: "State",
        body: `<blockquote>${escapeHtml(state.status)}</blockquote>`,
      });
    }

    if (state.activeRunId) {
      sections.push({
        heading: "Run",
        body: `<blockquote>${escapeHtml(state.activeRunId)}</blockquote>`,
      });
    }

    if (state.pendingApproval) {
      sections.push({
        heading: "Approval",
        body: `<blockquote>${escapeHtml(state.pendingApproval.id)}</blockquote>`,
      });
    }

    await this.telegram.sendMessage(
      chatId,
      this.renderStatusCard({
        title: "<b>📊 CC-IM Status</b>",
        workspaceStatusLine,
        sessionId: session?.sessionId,
        sections,
      }),
      { parseMode: "HTML" },
    );
  }

  private async showModeMenu(chatId: number): Promise<void> {
    const state = this.state.getChatState(chatId);
    await this.telegram.sendMessage(
      chatId,
      fmt`🛂 ${FormattedString.bold("Claude permission mode")}
Current: ${FormattedString.code(this.renderPermissionModeLabel(state.permissionMode))}`,
      {
        replyMarkup: buildModeMenu(state.permissionMode),
      },
    );
  }

  private async selectPermissionMode(
    chatId: number,
    permissionMode: PermissionMode,
  ): Promise<void> {
    if (!isPermissionMode(permissionMode)) {
      await this.telegram.sendMessage(chatId, "Unknown permission mode.");
      return;
    }
    this.state.setPermissionMode(chatId, permissionMode);
    const activeRun = this.activeRuns.get(chatId);
    const suffix = activeRun ? " This will apply to the next run." : "";
    await this.telegram.sendMessage(
      chatId,
      fmt`🛂 ${FormattedString.bold("Permission mode updated")}
${FormattedString.code(this.renderPermissionModeLabel(permissionMode))}.${suffix}`,
    );
  }

  private async showClaudeMenu(
    chatId: number,
    page: number,
    editMessageId?: number,
  ): Promise<void> {
    const state = this.state.getChatState(chatId);
    if (!state.selectedWorkspace) {
      await this.telegram.sendMessage(chatId, "Select a workspace first with /workspace.");
      return;
    }

    let session = this.state.getWorkspaceSession(state.selectedWorkspace);
    if (!session || session.slashCommands.length === 0) {
      const probe = await this.agent.probeSlashCommands(state.selectedWorkspace);
      session = this.state.setWorkspaceSession({
        workspaceName: state.selectedWorkspaceName || "workspace",
        workspacePath: state.selectedWorkspace,
        sessionId: probe.sessionId || session?.sessionId || "",
        slashCommands: probe.slashCommands,
        lastTouchedAt: Date.now(),
      });
    }

    if (session.slashCommands.length === 0) {
      await this.telegram.sendMessage(chatId, "No Claude slash commands were discovered.");
      return;
    }

    const menu = buildClaudeCommandsMenu(
      session.slashCommands,
      page,
      this.config.claudeCommandsPageSize,
    );
    const text = fmt`🧰 ${FormattedString.bold("Claude commands")}
📁 ${FormattedString.code(session.workspaceName)}`;
    if (editMessageId) {
      await this.telegram.editMessageText(chatId, editMessageId, text, {
        replyMarkup: menu,
      });
      return;
    }
    await this.telegram.sendMessage(chatId, text, {
      replyMarkup: menu,
    });
  }

  private async stopRun(chatId: number): Promise<void> {
    const activeRun = this.activeRuns.get(chatId);
    if (!activeRun) {
      await this.telegram.sendMessage(chatId, "No active run.");
      return;
    }
    const state = this.state.getChatState(chatId);
    if (state.pendingApproval) {
      clearPendingApprovalTimer(state.pendingApproval);
    }
    this.state.setPendingInputEdit(chatId, undefined);
    activeRun.stop();
    this.cancelProgressFlush(activeRun);
    this.stopTypingIndicator(activeRun);
    this.activeRuns.delete(chatId);
    this.state.setActiveRun(chatId);
    await this.telegram.sendMessage(chatId, "Stopped the active run.");
  }

  private async forwardToClaude(chatId: number, text: string, draftId?: number): Promise<void> {
    const state = this.state.getChatState(chatId);
    if (!state.selectedWorkspace || !state.selectedWorkspaceName) {
      await this.telegram.sendMessage(chatId, "Select a workspace first with /workspace.");
      return;
    }
    if (state.activeRunId) {
      // Queue the message instead of rejecting
      state.messageQueue.push(text);
      await this.telegram.sendMessage(
        chatId,
        `⏳ Message queued (${state.messageQueue.length} in queue). Will process after current run completes.`,
      );
      return;
    }

    await this.executeClaudeRun(chatId, text, draftId);
  }

  private async executeClaudeRun(chatId: number, text: string, draftId?: number): Promise<void> {
    const state = this.state.getChatState(chatId);
    const workspacePath = state.selectedWorkspace!;
    const workspaceName = state.selectedWorkspaceName!;
    const permissionMode = state.permissionMode;
    const workspaceStatusLine = await this.describeWorkspaceStatus(workspacePath, workspaceName);
    const existingSession = this.state.getWorkspaceSession(workspacePath);
    const runId = randomUUID();
    const progressMessageId = await this.telegram.sendMessage(
      chatId,
      this.renderInitialProgressText({
        workspaceStatusLine,
        hasCompletedOutput: false,
        toolCalls: [],
      }),
      { parseMode: "HTML" },
    );

    this.state.setActiveRun(chatId, runId, "running");
    this.activeRuns.set(chatId, {
      runId,
      progressMessageId,
      stop: () => {},
      contentDraftId: draftId || 1,
      accumulatedText: "",
      lastFlushedText: "",
      progressText: "",
      phase: "Starting",
      lastProgressFlushedText: "",
      sessionId: existingSession?.sessionId || "",
      workspacePath,
      workspaceName,
      workspaceStatusLine,
      permissionMode,
      toolCalls: [],
      startTime: Date.now(),
    });
    this.startTypingIndicator(chatId);
    this.pushProgress(chatId, `phase:Thinking`);

    const { sessionId, stop } = await this.agent.sendMessage({
      runId,
      workspacePath,
      sessionId: existingSession?.sessionId || undefined,
      message: text,
      mode: permissionMode,
      requestApproval: (request) => this.waitForApproval(chatId, runId, request),
      onEvent: async (event) => {
        await this.handleClaudeEvent(chatId, {
          event,
          runId,
          workspacePath,
          workspaceName,
        });
      },
    });

    const activeRun = this.activeRuns.get(chatId);
    if (activeRun && activeRun.runId === runId) {
      activeRun.stop = stop;
      activeRun.sessionId = sessionId || activeRun.sessionId;
    }

    this.state.setWorkspaceSession({
      workspaceName,
      workspacePath,
      sessionId: sessionId || existingSession?.sessionId || "",
      slashCommands: existingSession?.slashCommands || [],
      lastTouchedAt: Date.now(),
    });
  }

  private async handleClaudeEvent(
    chatId: number,
    args: {
      event: ClaudeEvent;
      runId: string;
      workspacePath: string;
      workspaceName: string;
    },
  ): Promise<void> {
    const activeRun = this.activeRuns.get(chatId);
    if (!activeRun || activeRun.runId !== args.runId) {
      return;
    }

    switch (args.event.type) {
      case "commands": {
        const existing = this.state.getWorkspaceSession(args.workspacePath);
        this.state.setWorkspaceSession({
          workspaceName: args.workspaceName,
          workspacePath: args.workspacePath,
          sessionId: activeRun.sessionId,
          slashCommands: args.event.commands,
          lastTouchedAt: Date.now(),
        });
        if (existing && existing.sessionId !== activeRun.sessionId) {
          this.logger.info("workspace session updated", {
            workspace: args.workspaceName,
            sessionId: activeRun.sessionId,
          });
        }
        return;
      }
      case "assistant_text": {
        activeRun.accumulatedText += args.event.text;
        this.logger.run(args.runId, "assistant text received", {
          length: args.event.text.length,
          totalLength: activeRun.accumulatedText.length,
        });
        this.stopTypingIndicator(activeRun);
        this.scheduleContentFlush(chatId);
        return;
      }
      case "status": {
        this.logger.run(args.runId, "status", { message: args.event.message });
        const readySessionId = this.extractSessionIdFromStatus(args.event.message);
        if (readySessionId) {
          activeRun.sessionId = readySessionId;
          this.state.setWorkspaceSession({
            workspaceName: args.workspaceName,
            workspacePath: args.workspacePath,
            sessionId: readySessionId,
            slashCommands: this.state.getWorkspaceSession(args.workspacePath)?.slashCommands || [],
            lastTouchedAt: Date.now(),
          });
        }
        this.pushProgress(chatId, args.event.message);
        return;
      }
      case "approval_requested": {
        this.pushProgress(chatId, `approval:Waiting for ${args.event.request.toolName}`, true);
        return;
      }
      case "approval_cancelled": {
        const state = this.state.getChatState(chatId);
        if (state.pendingApproval?.id === args.event.approvalId) {
          clearPendingApprovalTimer(state.pendingApproval);
          this.state.setPendingInputEdit(chatId, undefined);
          this.state.setPendingApproval(chatId, undefined);
          await this.telegram.sendMessage(chatId, "Approval request was cancelled by Claude.");
        }
        return;
      }
      case "run_completed": {
        activeRun.phase = "Completed";
        this.cancelProgressFlush(activeRun);
        this.stopTypingIndicator(activeRun);
        try {
          try {
            await this.flushProgressMessage(chatId, true);
          } catch (error) {
            this.logger.error("failed to flush progress message on completion", {
              chatId,
              runId: activeRun.runId,
              error: error instanceof Error ? error.message : String(error),
            });
          }

          try {
            await this.flushContentMessage(chatId, true);
          } catch (error) {
            this.logger.error("failed to flush content message on completion", {
              chatId,
              runId: activeRun.runId,
              error: error instanceof Error ? error.message : String(error),
            });
          }

          if (!activeRun.accumulatedText.trim()) {
            await this.telegram.sendMessage(
              chatId,
              "Error: Claude completed without returning any visible output.",
            );
          }
        } finally {
          this.state.setActiveRun(chatId);
          this.activeRuns.delete(chatId);
        }
        await this.processMessageQueue(chatId);
        return;
      }
      case "run_failed": {
        activeRun.phase = "Failed";
        this.cancelProgressFlush(activeRun);
        this.stopTypingIndicator(activeRun);
        try {
          try {
            await this.flushProgressMessage(chatId, true);
          } catch (error) {
            this.logger.error("failed to flush progress message on failure", {
              chatId,
              runId: activeRun.runId,
              error: error instanceof Error ? error.message : String(error),
            });
          }

          try {
            await this.flushContentMessage(chatId, true);
          } catch (error) {
            this.logger.error("failed to flush content message on failure", {
              chatId,
              runId: activeRun.runId,
              error: error instanceof Error ? error.message : String(error),
            });
          }

          await this.telegram.sendMessage(
            chatId,
            fmt`❌ ${FormattedString.bold("Run failed")}
${FormattedString.code(args.event.message)}`,
          );
        } finally {
          this.state.setActiveRun(chatId);
          this.activeRuns.delete(chatId);
        }
        await this.processMessageQueue(chatId);
        return;
      }
    }
  }

  private scheduleContentFlush(chatId: number): void {
    const activeRun = this.activeRuns.get(chatId);
    if (!activeRun || activeRun.flushTimer) {
      return;
    }
    activeRun.flushTimer = setTimeout(async () => {
      activeRun.flushTimer = undefined;
      await this.flushContentMessage(chatId, false);
    }, 1200);
  }

  private startTypingIndicator(chatId: number): void {
    const activeRun = this.activeRuns.get(chatId);
    if (!activeRun || activeRun.typingTimer) {
      return;
    }
    void this.telegram.sendTyping(chatId);
    activeRun.typingTimer = setInterval(() => {
      void this.telegram.sendTyping(chatId);
    }, 4000);
  }

  private stopTypingIndicator(activeRun: ActiveRunRecord): void {
    if (!activeRun.typingTimer) {
      return;
    }
    clearInterval(activeRun.typingTimer);
    activeRun.typingTimer = undefined;
  }

  private async flushContentMessage(chatId: number, force: boolean): Promise<void> {
    const activeRun = this.activeRuns.get(chatId);
    if (!activeRun) {
      return;
    }
    const text = activeRun.accumulatedText.trim();
    if (!text) {
      this.logger.run(activeRun.runId, "content flush skipped: empty", { force });
      return;
    }
    // 先检查是否需要刷新，避免不必要的 clipForTelegram 计算
    if (!force && text === activeRun.lastFlushedText) {
      return;
    }
    const clipped = clipForTelegram(text);
    activeRun.lastFlushedText = text;
    if (!force) {
      this.logger.run(activeRun.runId, "content draft flush", {
        length: clipped.length,
      });
      await this.telegram.sendMessageDraft(chatId, activeRun.contentDraftId, clipped);
      return;
    }
    const html = markdownToTelegramHtml(clipped);
    try {
      this.logger.run(activeRun.runId, "content final flush html", {
        length: html.length,
      });
      await this.telegram.sendMessage(chatId, html, { parseMode: "HTML" });
    } catch {
      this.logger.run(activeRun.runId, "content final flush plain", {
        length: clipped.length,
      });
      await this.telegram.sendMessage(chatId, clipped);
    }
  }

  private async resolveApproval(
    chatId: number,
    approvalId: string,
    decision: ApprovalDecision,
  ): Promise<void> {
    const state = this.state.getChatState(chatId);
    const pendingApproval = state.pendingApproval;
    if (!pendingApproval || pendingApproval.id !== approvalId) {
      await this.telegram.sendMessage(chatId, "Approval request not found.");
      return;
    }
    clearPendingApprovalTimer(pendingApproval);
    this.pushProgress(chatId, `approval:${renderApprovalDecision(decision)}`, true);
    this.state.setPendingInputEdit(chatId, undefined);
    this.state.setPendingApproval(chatId, undefined);
    pendingApproval.resolve?.(decision);
    await this.telegram.sendMessage(
      chatId,
      fmt`✅ ${FormattedString.bold(renderApprovalDecision(decision))} for ${FormattedString.code(approvalId)}.`,
    );
  }

  private async waitForApproval(
    chatId: number,
    runId: string,
    request: ApprovalRequest,
  ): Promise<ApprovalDecision> {
    return await new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        void this.resolveApproval(chatId, request.approvalId, {
          type: "reject",
          message: "Approval timed out",
        });
      }, this.config.claudeApprovalTimeoutMs);

      const pendingApproval = {
        id: request.approvalId,
        runId,
        request,
        createdAt: Date.now(),
        timeoutId,
        resolve,
      };
      this.state.setPendingApproval(chatId, pendingApproval);
      void this.telegram.sendMessage(chatId, this.renderApprovalRequest(request), {
        parseMode: "HTML",
        replyMarkup: buildApprovalMenu(request.approvalId),
      });
    });
  }

  private async promptApprovalInputEdit(chatId: number, approvalId: string): Promise<void> {
    const state = this.state.getChatState(chatId);
    const pendingApproval = state.pendingApproval;
    if (!pendingApproval || pendingApproval.id !== approvalId) {
      await this.telegram.sendMessage(chatId, "Approval request not found.");
      return;
    }

    const promptMessageId = await this.telegram.sendMessage(
      chatId,
      "Reply with the full replacement JSON for tool input.",
      {
        replyMarkup: { force_reply: true, selective: true },
      },
    );
    this.state.setPendingInputEdit(chatId, { approvalId, promptMessageId });
  }

  private async handleApprovalInputEdit(chatId: number, text: string): Promise<void> {
    const state = this.state.getChatState(chatId);
    const pendingInputEdit = state.pendingInputEdit;
    const pendingApproval = state.pendingApproval;
    if (
      !pendingInputEdit ||
      !pendingApproval ||
      pendingApproval.id !== pendingInputEdit.approvalId
    ) {
      return;
    }

    let updatedInput: Record<string, unknown>;
    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Input must be a JSON object");
      }
      updatedInput = parsed as Record<string, unknown>;
    } catch (error) {
      await this.telegram.sendMessage(
        chatId,
        `Invalid JSON input: ${(error as Error).message}. Reply again with a JSON object.`,
      );
      return;
    }

    await this.resolveApproval(chatId, pendingApproval.id, { type: "edit", updatedInput });
  }

  private pushProgress(chatId: number, line: string, forceFlush = false): void {
    const activeRun = this.activeRuns.get(chatId);
    if (!activeRun) {
      return;
    }
    const clean = line.trim();
    if (!clean) {
      return;
    }
    this.applyProgressUpdate(activeRun, clean);
    activeRun.progressText = this.renderProgressText(activeRun);
    this.scheduleProgressFlush(chatId, forceFlush);
  }

  private scheduleProgressFlush(chatId: number, force: boolean): void {
    const activeRun = this.activeRuns.get(chatId);
    if (!activeRun) {
      return;
    }
    if (force) {
      this.cancelProgressFlush(activeRun);
      void this.flushProgressMessage(chatId, true);
      return;
    }

    const now = Date.now();
    const debounceMs = this.config.telegramProgressDebounceMs;
    const minIntervalMs = this.config.telegramProgressMinIntervalMs;
    const minIntervalDelay = activeRun.lastProgressSentAt
      ? Math.max(0, activeRun.lastProgressSentAt + minIntervalMs - now)
      : 0;
    const rateLimitDelay = activeRun.progressRateLimitedUntil
      ? Math.max(0, activeRun.progressRateLimitedUntil - now)
      : 0;
    const delayMs = Math.max(debounceMs, minIntervalDelay, rateLimitDelay);

    if (activeRun.progressFlushTimer) {
      clearTimeout(activeRun.progressFlushTimer);
    }
    activeRun.progressFlushTimer = setTimeout(async () => {
      activeRun.progressFlushTimer = undefined;
      await this.flushProgressMessage(chatId, false);
    }, delayMs);
  }

  private cancelProgressFlush(activeRun: ActiveRunRecord): void {
    if (!activeRun.progressFlushTimer) {
      return;
    }
    clearTimeout(activeRun.progressFlushTimer);
    activeRun.progressFlushTimer = undefined;
  }

  private async flushProgressMessage(chatId: number, force: boolean): Promise<void> {
    const activeRun = this.activeRuns.get(chatId);
    if (!activeRun) {
      return;
    }
    if (activeRun.progressUpdateInFlight) {
      return;
    }
    if (
      !force &&
      activeRun.progressRateLimitedUntil &&
      Date.now() < activeRun.progressRateLimitedUntil
    ) {
      this.scheduleProgressFlush(chatId, false);
      return;
    }
    // Re-render progress text
    const newProgressText = this.renderProgressText(activeRun);
    // Only update if forced or text changed
    if (!force && newProgressText === activeRun.lastProgressFlushedText) {
      return;
    }
    activeRun.progressText = newProgressText;
    activeRun.progressUpdateInFlight = true;
    try {
      await this.telegram.editMessageText(chatId, activeRun.progressMessageId, newProgressText, {
        parseMode: "HTML",
      });
      activeRun.lastProgressFlushedText = newProgressText;
      activeRun.progressRateLimitedUntil = undefined;
      activeRun.lastProgressSentAt = Date.now();
    } catch (error) {
      const retryAfterMs = parseTelegramRetryAfterMs(error);
      if (retryAfterMs) {
        activeRun.progressRateLimitedUntil = Date.now() + retryAfterMs;
        this.logger.info("telegram progress edit rate limited", {
          chatId,
          retryAfterMs,
          progressMessageId: activeRun.progressMessageId,
        });
        this.scheduleProgressFlush(chatId, false);
        return;
      }
      throw error;
    } finally {
      activeRun.progressUpdateInFlight = false;
    }
  }

  private applyProgressUpdate(activeRun: ActiveRunRecord, line: string): void {
    // 处理工具调用开始
    if (line.startsWith(PROGRESS_PREFIXES.TOOL_START)) {
      const payload = line.slice(PROGRESS_PREFIXES.TOOL_START.length);
      const [name, detail] = payload.split("|");
      const parsedDuration = Number(detail);
      const toolCall: ToolCall = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: name || "unknown",
        status: "running",
        input: detail && Number.isNaN(parsedDuration) ? detail : undefined,
        startedAt: Date.now() - (!Number.isNaN(parsedDuration) ? parsedDuration : 0) * 1000,
      };
      activeRun.currentTool = toolCall.name;
      activeRun.currentToolCall = toolCall;
      activeRun.phase = "Using tool";
      activeRun.toolCalls.push(toolCall);
      // 限制工具调用历史数量
      if (activeRun.toolCalls.length > 10) {
        activeRun.toolCalls.shift();
      }
      return;
    }

    // 处理工具调用结束
    if (line.startsWith(PROGRESS_PREFIXES.TOOL_END)) {
      const payload = line.slice(PROGRESS_PREFIXES.TOOL_END.length);
      const [name, result] = payload.split("|");
      const toolCall = activeRun.currentToolCall;
      if (toolCall && toolCall.name === name) {
        toolCall.status = "completed";
        toolCall.result = result || "";
        toolCall.completedAt = Date.now();
        toolCall.duration = Math.floor((toolCall.completedAt - toolCall.startedAt) / 1000);
        activeRun.currentToolCall = undefined;
        activeRun.currentTool = undefined;
      }
      activeRun.phase = "Processing result";
      return;
    }

    // 处理其他前缀
    const handlers: Record<string, (value: string) => void> = {
      [PROGRESS_PREFIXES.PHASE]: (value) => {
        activeRun.phase = value;
      },
      [PROGRESS_PREFIXES.APPROVAL]: (value) => {
        activeRun.approvalState = value;
      },
      [PROGRESS_PREFIXES.TOOL_RESULT]: (value) => {
        if (activeRun.currentToolCall) {
          activeRun.currentToolCall.result = value;
        }
      },
      [PROGRESS_PREFIXES.COMMAND_OUTPUT]: (value) => {
        if (activeRun.currentToolCall) {
          activeRun.currentToolCall.result = value;
        }
      },
      [PROGRESS_PREFIXES.CLAUDE_STATUS]: (value) => {
        activeRun.phase = value || activeRun.phase;
      },
      [PROGRESS_PREFIXES.EVENT]: () => {
        // 忽略普通事件
      },
    };

    for (const [prefix, handler] of Object.entries(handlers)) {
      if (line.startsWith(prefix)) {
        handler(line.slice(prefix.length).trim());
        return;
      }
    }

    // 特殊处理精确匹配
    if (line === PROGRESS_PREFIXES.THINKING) {
      activeRun.phase = "Thinking";
      return;
    }
    if (line.startsWith(PROGRESS_PREFIXES.SESSION_READY)) {
      activeRun.phase = "Ready";
      return;
    }
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remaining = seconds % 60;
    return `${minutes}m ${remaining}s`;
  }

  private renderProgressText(activeRun: ActiveRunRecord): string {
    const hasCompletedOutput = activeRun.phase === "Completed";
    const elapsed = Date.now() - activeRun.startTime;
    return this.renderInitialProgressText({
      workspaceStatusLine: activeRun.workspaceStatusLine,
      hasCompletedOutput,
      toolCalls: activeRun.toolCalls,
      currentToolCall: activeRun.currentToolCall,
      spinnerIndex: Math.floor(elapsed / 700),
      toolSpinnerIndex: Math.floor(elapsed / 700),
      sessionId: activeRun.sessionId,
    });
  }

  private renderInitialProgressText(args: {
    workspaceStatusLine: string;
    hasCompletedOutput: boolean;
    toolCalls: ToolCall[];
    currentToolCall?: ToolCall;
    spinnerIndex?: number;
    toolSpinnerIndex?: number;
    sessionId?: string;
  }): string {
    const spinnerChar =
      SPINNER_CHARS[(args.spinnerIndex || 0) % SPINNER_CHARS.length] || SPINNER_CHARS[0];
    const headerText = args.hasCompletedOutput
      ? "<b>✅ Claude Code</b>"
      : `<b><code>${spinnerChar}</code> Claude Code</b>`;

    const toolSpinnerChar =
      TOOL_SPINNER_CHARS[(args.toolSpinnerIndex || 0) % TOOL_SPINNER_CHARS.length] ||
      TOOL_SPINNER_CHARS[0];
    const toolBlocks = this.renderToolUseBlocks(
      args.toolCalls,
      args.currentToolCall,
      toolSpinnerChar,
    );
    const sections =
      toolBlocks.length > 0 ? [{ heading: "Tool", body: toolBlocks.join("\n") }] : undefined;

    return this.renderStatusCard({
      title: headerText,
      workspaceStatusLine: args.workspaceStatusLine,
      sessionId: args.sessionId,
      sections,
    });
  }

  private renderStatusCard(args: {
    title: string;
    workspaceStatusLine: string;
    sessionId?: string;
    sections?: Array<{ heading: string; body: string }>;
  }): string {
    const lines = [
      args.title,
      `<i>${escapeHtml(args.workspaceStatusLine)}</i>`,
      `<i>${escapeHtml(this.renderCurrentPermissionModeLabel())}</i>`,
    ];

    if (args.sessionId) {
      lines.push(`<code>${escapeHtml(args.sessionId)}</code>`);
    }

    for (const section of args.sections || []) {
      lines.push("");
      lines.push(`<b>${escapeHtml(section.heading)}</b>`);
      lines.push(section.body);
    }

    return lines.join("\n");
  }

  private renderCurrentPermissionModeLabel(): string {
    const chatState = this.state.getChatState(this.config.telegramAllowedChatId);
    return this.renderPermissionModeLabel(chatState.permissionMode);
  }

  private renderPermissionModeLabel(mode?: PermissionMode): string {
    switch (mode || this.config.claudeDefaultPermissionMode) {
      case "acceptEdits":
        return "⏵︎⏵︎ acceptEdits mode on";
      case "auto":
        return "auto mode on";
      case "dontAsk":
        return "⏵︎⏵︎ dontAsk mode on";
      case "plan":
        return "plan mode on";
      case "bypassPermissions":
        return "⏵︎⏵︎ bypassPermissions mode on";
      default:
        return "default mode on";
    }
  }

  private renderApprovalRequest(request: ApprovalRequest): string {
    const input = clipForTelegram(JSON.stringify(request.input, null, 2));
    const lines = [
      "<b>🛂 Claude needs approval</b>",
      `<b>Tool</b>\n<blockquote>${escapeHtml(request.toolName)}</blockquote>`,
      `<b>Input</b>\n<pre>${escapeHtml(input)}</pre>`,
    ];
    if (request.description) {
      lines.push(`<b>Description</b>\n<blockquote>${escapeHtml(request.description)}</blockquote>`);
    }
    if (request.blockedPath) {
      lines.push(
        `<b>Blocked path</b>\n<blockquote>${escapeHtml(request.blockedPath)}</blockquote>`,
      );
    }
    return lines.join("\n");
  }

  private async describeWorkspaceStatus(
    workspacePath: string,
    workspaceName: string,
  ): Promise<string> {
    const gitArgs = ["git", "-C", workspacePath];

    // Check if we're in a git repo
    const insideWorkTree = await spawnAsync([...gitArgs, "rev-parse", "--is-inside-work-tree"]);
    if (insideWorkTree.exitCode !== 0 || insideWorkTree.stdout.trim() !== "true") {
      return `${workspaceName} no-git`;
    }

    // Run branch and status in parallel
    const [branchResult, statusResult] = await Promise.all([
      spawnAsync([...gitArgs, "branch", "--show-current"]),
      spawnAsync([...gitArgs, "status", "--porcelain"]),
    ]);

    const branch = branchResult.stdout.trim() || "detached";
    const dirty = statusResult.stdout.trim().length > 0;
    return `${workspaceName} ${branch} ${dirty ? "✗" : "✓"}`;
  }

  private renderToolUseBlocks(
    toolCalls: ToolCall[],
    currentToolCall?: ToolCall,
    runningSpinner?: string,
  ): string[] {
    const blocks: string[] = [];

    if (currentToolCall) {
      const spinner = runningSpinner || "…";
      blocks.push(this.renderToolUseBlock(spinner, currentToolCall, TOOL_STATUS_LABELS.RUNNING));
    }

    for (const tool of toolCalls.slice(-5).reverse()) {
      if (currentToolCall && tool.id === currentToolCall.id) {
        continue;
      }

      if (tool.status === "completed") {
        blocks.push(this.renderToolUseBlock("✓", tool));
        continue;
      }

      if (tool.status === "failed") {
        blocks.push(this.renderToolUseBlock("×", tool));
      }
    }

    return blocks;
  }

  private renderToolUseBlock(icon: string, tool: ToolCall, suffix?: string): string {
    const title = `${icon} ${tool.name}${suffix ? ` ${suffix}` : ""}`;
    const detail = this.formatToolDetail(tool);
    if (!detail) {
      return `<blockquote>${escapeHtml(title)}</blockquote>`;
    }
    return `<blockquote>${escapeHtml(title)}</blockquote>\n<blockquote expandable>${escapeHtml(detail)}</blockquote>`;
  }

  private formatToolDetail(tool: ToolCall): string {
    if (tool.input) {
      return this.prettyPrintToolDetail(tool.input);
    }
    if (tool.result) {
      return this.prettyPrintToolDetail(tool.result);
    }
    return "";
  }

  private prettyPrintToolDetail(detail: string): string {
    const trimmed = detail.trim();
    if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) {
      return detail;
    }

    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      return detail;
    }
  }

  private isAllowedChat(chatId: number): boolean {
    if (!this.config.telegramAllowedChatId) {
      return true;
    }
    return this.config.telegramAllowedChatId === chatId;
  }

  private phaseBadge(phase: string): string {
    return PHASE_BADGES[phase.toLowerCase()] ?? "⚡";
  }

  private extractSessionIdFromStatus(message: string): string | undefined {
    const prefix = PROGRESS_PREFIXES.SESSION_READY;
    if (message.startsWith(prefix)) {
      return message.slice(prefix.length).trim();
    }
    return undefined;
  }

  private async processMessageQueue(chatId: number): Promise<void> {
    const state = this.state.getChatState(chatId);
    if (state.messageQueue.length === 0) {
      return;
    }
    const nextMessage = state.messageQueue.shift();
    if (nextMessage) {
      await this.telegram.sendMessage(chatId, `▶️ Processing queued message...`);
      await this.forwardToClaude(chatId, nextMessage);
    }
  }
}

function isPermissionMode(value: string): value is PermissionMode {
  return (
    value === "default" ||
    value === "acceptEdits" ||
    value === "auto" ||
    value === "dontAsk" ||
    value === "plan" ||
    value === "bypassPermissions"
  );
}

function clearPendingApprovalTimer(pendingApproval: { timeoutId?: Timer } | undefined): void {
  if (pendingApproval?.timeoutId) {
    clearTimeout(pendingApproval.timeoutId);
  }
}

function renderApprovalDecision(decision: ApprovalDecision): string {
  switch (decision.type) {
    case "approve":
      return "Approved";
    case "edit":
      return "Approved with edited input";
    default:
      return "Rejected";
  }
}

function parseTelegramRetryAfterMs(error: unknown): number | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }
  const match = error.message.match(/retry after (\d+)/i);
  if (!match) {
    return undefined;
  }
  const seconds = Number(match[1]);
  if (Number.isNaN(seconds) || seconds <= 0) {
    return undefined;
  }
  return seconds * 1000;
}
