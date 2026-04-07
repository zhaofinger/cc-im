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
  buildWorkspaceMenu,
} from "../telegram/menus.ts";
import type { AppCallback, AppMessage, ClaudeEvent } from "../types.ts";
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
  sessionId: string;
  workspacePath: string;
  workspaceName: string;
  workspaceStatusLine: string;
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
    this.state = new MemoryState(resolve(config.logDir, "chat-selection.json"));
  }

  async setup(): Promise<void> {
    await this.telegram.setMyCommands([
      { command: "start", description: "ℹ️ Show help" },
      { command: "workspace", description: "📁 Choose a workspace" },
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

    if (text === "/start") {
      await this.telegram.sendMessage(
        chatId,
        fmt`${FormattedString.bold("cc-im")}

${FormattedString.bold("Commands")}
${FormattedString.code("/workspace")} - choose a workspace
${FormattedString.code("/status")} - show current status
${FormattedString.code("/stop")} - stop the current run
${FormattedString.code("/cc")} - show Claude slash commands

All other text is forwarded to Claude Code.

Note: This bot uses --dangerously-skip-permissions mode.`,
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
      await this.resolveApproval(chatId, data.slice(8), "approve");
      return;
    }

    if (data.startsWith("reject:")) {
      await this.resolveApproval(chatId, data.slice(7), "reject");
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
    let session = existingSession;
    if (!session) {
      const probe = await this.agent.probeSlashCommands(workspacePath);
      session = this.state.setWorkspaceSession({
        workspaceName,
        workspacePath,
        sessionId: probe.sessionId || existingSession?.sessionId || "",
        slashCommands: probe.slashCommands,
        lastTouchedAt: Date.now(),
      });
    }

    await this.telegram.sendMessage(
      chatId,
      fmt`✅ ${FormattedString.bold("Workspace selected")}
📁 ${FormattedString.code(workspaceName)}
🧵 Session: ${FormattedString.code(session.sessionId)}`,
    );
  }

  private async showStatus(chatId: number): Promise<void> {
    const state = this.state.getChatState(chatId);
    const session = state.selectedWorkspace
      ? this.state.getWorkspaceSession(state.selectedWorkspace)
      : undefined;
    let message = fmt`📊 ${FormattedString.bold("CC-IM Status")}
🧠 State: ${FormattedString.code(state.status)}
📁 Workspace: ${FormattedString.code(state.selectedWorkspaceName || "not selected")}
🧵 Session: ${FormattedString.code(session?.sessionId || "none")}
🏃 Run: ${FormattedString.code(state.activeRunId || "idle")}`;
    if (state.pendingApproval) {
      message = fmt`${message}
✅ Approval: ${FormattedString.code(state.pendingApproval.id)}`;
    }
    await this.telegram.sendMessage(chatId, message);
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
    activeRun.stop();
    this.stopProgressTicker(activeRun);
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

    // TODO: Implement interactive approval mode
    // Currently always runs in dangerous mode (--dangerously-skip-permissions)
    // To implement approval modes, need to:
    // 1. Capture permission_denials from stream-json output
    // 2. Forward to Telegram for user approval
    // 3. Resume or cancel the operation based on user response
    // See: https://github.com/anthropics/claude-code/issues/xxx

    await this.executeClaudeRun(chatId, text, draftId);
  }

  private async executeClaudeRun(chatId: number, text: string, draftId?: number): Promise<void> {
    const state = this.state.getChatState(chatId);
    const workspacePath = state.selectedWorkspace!;
    const workspaceName = state.selectedWorkspaceName!;
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
      toolCalls: [],
      startTime: Date.now(),
    });
    this.startProgressTicker(chatId);
    this.startTypingIndicator(chatId);
    this.pushProgress(chatId, `phase:Thinking`);

    // TODO: To implement approval modes:
    // 1. Run Claude without --dangerously-skip-permissions
    // 2. Parse permission_denials from stream-json output
    // 3. Call waitForApproval when permission is needed
    // 4. Currently always using dangerous mode for simplicity

    const { sessionId, stop } = await this.agent.sendMessage({
      runId,
      workspacePath,
      sessionId: existingSession?.sessionId || undefined,
      message: text,
      dangerouslySkipPermissions: true,
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
        this.pushProgress(chatId, "approval:Waiting for approval");
        return;
      }
      case "run_completed": {
        activeRun.phase = "Completed";
        this.stopProgressTicker(activeRun);
        await this.flushProgressMessage(chatId, true);
        await this.flushContentMessage(chatId, true);
        this.stopTypingIndicator(activeRun);
        this.state.setActiveRun(chatId);
        this.activeRuns.delete(chatId);
        await this.processMessageQueue(chatId);
        return;
      }
      case "run_failed": {
        activeRun.phase = "Failed";
        this.stopProgressTicker(activeRun);
        await this.flushProgressMessage(chatId, true);
        await this.flushContentMessage(chatId, true);
        this.stopTypingIndicator(activeRun);
        await this.telegram.sendMessage(
          chatId,
          fmt`❌ ${FormattedString.bold("Run failed")}
${FormattedString.code(args.event.message)}`,
        );
        this.state.setActiveRun(chatId);
        this.activeRuns.delete(chatId);
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
      return;
    }
    // 先检查是否需要刷新，避免不必要的 clipForTelegram 计算
    if (!force && text === activeRun.lastFlushedText) {
      return;
    }
    const clipped = clipForTelegram(text);
    activeRun.lastFlushedText = text;
    if (!force) {
      await this.telegram.sendMessageDraft(chatId, activeRun.contentDraftId, clipped);
      return;
    }
    const html = markdownToTelegramHtml(clipped);
    try {
      await this.telegram.sendMessage(chatId, html, { parseMode: "HTML" });
    } catch {
      await this.telegram.sendMessage(chatId, clipped);
    }
  }

  private async resolveApproval(
    chatId: number,
    approvalId: string,
    decision: "approve" | "reject",
  ): Promise<void> {
    const state = this.state.getChatState(chatId);
    const pendingApproval = state.pendingApproval;
    if (!pendingApproval || pendingApproval.id !== approvalId) {
      await this.telegram.sendMessage(chatId, "Approval request not found.");
      return;
    }
    this.pushProgress(chatId, `approval:Approval ${decision}d`);
    this.state.setPendingApproval(chatId, undefined);
    pendingApproval.resolve?.(decision);
    await this.telegram.sendMessage(
      chatId,
      fmt`✅ Approval ${FormattedString.bold(`${decision}d`)} for ${FormattedString.code(approvalId)}.`,
    );
  }

  private async waitForApproval(
    chatId: number,
    runId: string,
    request: { approvalId: string; summary: string },
  ): Promise<"approve" | "reject"> {
    // TODO: This method is not currently called because we use --dangerously-skip-permissions
    // To implement approval modes, need to:
    // 1. Run Claude without --dangerously-skip-permissions
    // 2. Parse permission_denials from stream-json output
    // 3. Call this method when permission is needed

    return await new Promise((resolve) => {
      this.state.setPendingApproval(chatId, {
        id: request.approvalId,
        runId,
        summary: request.summary,
        createdAt: Date.now(),
        resolve,
      });
      void this.telegram.sendMessage(
        chatId,
        fmt`🛂 ${FormattedString.bold("Claude needs approval")}
${FormattedString.pre(request.summary.slice(0, 350))}`,
        {
          replyMarkup: buildApprovalMenu(request.approvalId),
        },
      );
    });
  }

  private pushProgress(chatId: number, line: string): void {
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
  }

  private startProgressTicker(chatId: number): void {
    const activeRun = this.activeRuns.get(chatId);
    if (!activeRun || activeRun.progressFlushTimer) {
      return;
    }
    activeRun.progressFlushTimer = setInterval(async () => {
      await this.flushProgressMessage(chatId, false);
    }, 700);
  }

  private stopProgressTicker(activeRun: ActiveRunRecord): void {
    if (!activeRun.progressFlushTimer) {
      return;
    }
    clearInterval(activeRun.progressFlushTimer);
    activeRun.progressFlushTimer = undefined;
  }

  private async flushProgressMessage(chatId: number, force: boolean): Promise<void> {
    const activeRun = this.activeRuns.get(chatId);
    if (!activeRun) {
      return;
    }
    // Re-render progress text
    const newProgressText = this.renderProgressText(activeRun);
    // Only update if forced or text changed
    if (!force && newProgressText === activeRun.lastProgressFlushedText) {
      return;
    }
    activeRun.progressText = newProgressText;
    activeRun.lastProgressFlushedText = newProgressText;
    await this.telegram.editMessageText(chatId, activeRun.progressMessageId, newProgressText, {
      parseMode: "HTML",
    });
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
    });
  }

  private renderInitialProgressText(args: {
    workspaceStatusLine: string;
    hasCompletedOutput: boolean;
    toolCalls: ToolCall[];
    currentToolCall?: ToolCall;
    spinnerIndex?: number;
    toolSpinnerIndex?: number;
  }): string {
    const spinnerChar =
      SPINNER_CHARS[(args.spinnerIndex || 0) % SPINNER_CHARS.length] || SPINNER_CHARS[0];
    const headerText = args.hasCompletedOutput
      ? "<b>✅ Claude Code</b>"
      : `<b><code>${spinnerChar}</code> Claude Code</b>`;
    const lines = [
      headerText,
      `<code>${escapeHtml(args.workspaceStatusLine)}</code>`,
      `<code>${escapeHtml(this.renderPermissionModeLabel())}</code>`,
    ];

    const toolSpinnerChar =
      TOOL_SPINNER_CHARS[(args.toolSpinnerIndex || 0) % TOOL_SPINNER_CHARS.length] ||
      TOOL_SPINNER_CHARS[0];
    const toolBlocks = this.renderToolUseBlocks(
      args.toolCalls,
      args.currentToolCall,
      toolSpinnerChar,
    );
    if (toolBlocks.length > 0) {
      lines.push("");
      lines.push(`<b>Tool</b>`);
      lines.push(...toolBlocks);
    }

    return lines.join("\n");
  }

  private renderPermissionModeLabel(): string {
    // Always runs in dangerous mode (--dangerously-skip-permissions)
    // See TODO comments about implementing interactive approval modes
    return "›› bypass permissions on";
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
      return `<blockquote expandable>${escapeHtml(title)}</blockquote>`;
    }
    return `<blockquote expandable>${escapeHtml(title)}\n${escapeHtml(detail)}</blockquote>`;
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
