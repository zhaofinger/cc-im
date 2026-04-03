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
import { clipForTelegram, shorten } from "../utils/string.ts";
import { listWorkspaceNames, resolveWorkspacePath } from "../utils/workspace.ts";

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
      { command: "start", description: "Show help" },
      { command: "workspace", description: "Choose a workspace" },
      { command: "status", description: "Show current status" },
      { command: "stop", description: "Stop the active run" },
      { command: "cc", description: "Open Claude command menu" },
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

All other text is forwarded to Claude Code.`,
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

    let session = this.state.getWorkspaceSession(workspacePath);
    if (!session) {
      const probe = await this.agent.probeSlashCommands(workspacePath);
      session = this.state.setWorkspaceSession({
        workspaceName,
        workspacePath,
        sessionId: probe.sessionId || randomUUID(),
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
    let message = fmt`📊 ${FormattedString.bold("CC-IM Status")}
🧠 State: ${FormattedString.code(state.status)}
📁 Workspace: ${FormattedString.code(state.selectedWorkspaceName || "not selected")}
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
        sessionId: probe.sessionId || session?.sessionId || randomUUID(),
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
      await this.telegram.sendMessage(
        chatId,
        "A run is already in progress. Use /stop or wait for it to finish.",
      );
      return;
    }

    const workspacePath = state.selectedWorkspace;
    const workspaceName = state.selectedWorkspaceName;
    const existingSession = this.state.getWorkspaceSession(workspacePath);
    const runId = randomUUID();
    const progressMessageId = await this.telegram.sendMessage(
      chatId,
      FormattedString.pre(this.renderInitialProgressText(runId, workspaceName)),
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
      sessionId: existingSession?.sessionId || randomUUID(),
      workspacePath,
      workspaceName,
      toolCalls: [],
      startTime: Date.now(),
    });
    this.startTypingIndicator(chatId);
    this.pushProgress(chatId, `phase:Thinking`);

    const { sessionId, stop } = await this.agent.sendMessage({
      runId,
      workspacePath,
      sessionId: existingSession?.sessionId,
      message: text,
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
      activeRun.sessionId = sessionId;
    }

    this.state.setWorkspaceSession({
      workspaceName,
      workspacePath,
      sessionId,
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
        this.pushProgress(chatId, args.event.message);
        return;
      }
      case "approval_requested": {
        this.pushProgress(chatId, "approval:Waiting for approval");
        return;
      }
      case "run_completed": {
        activeRun.phase = "Completed";
        await this.flushProgressMessage(chatId, true);
        await this.flushContentMessage(chatId, true);
        this.stopTypingIndicator(activeRun);
        this.state.setActiveRun(chatId);
        this.activeRuns.delete(chatId);
        return;
      }
      case "run_failed": {
        activeRun.phase = "Failed";
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
    const text = activeRun.accumulatedText.trim() || "Waiting for Claude output...";
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
    this.scheduleProgressFlush(chatId);
  }

  private scheduleProgressFlush(chatId: number): void {
    const activeRun = this.activeRuns.get(chatId);
    if (!activeRun || activeRun.progressFlushTimer) {
      return;
    }
    activeRun.progressFlushTimer = setTimeout(async () => {
      activeRun.progressFlushTimer = undefined;
      await this.flushProgressMessage(chatId, false);
    }, 700);
  }

  private async flushProgressMessage(chatId: number, force: boolean): Promise<void> {
    const activeRun = this.activeRuns.get(chatId);
    if (!activeRun) {
      return;
    }
    const clipped = clipForTelegram(activeRun.progressText);
    if (!force && clipped === activeRun.lastProgressFlushedText) {
      return;
    }
    activeRun.lastProgressFlushedText = clipped;
    await this.telegram.editMessageText(
      chatId,
      activeRun.progressMessageId,
      FormattedString.pre(clipped),
    );
  }

  private applyProgressUpdate(activeRun: ActiveRunRecord, line: string): void {
    // 处理工具调用开始
    if (line.startsWith(PROGRESS_PREFIXES.TOOL_START)) {
      const payload = line.slice(PROGRESS_PREFIXES.TOOL_START.length);
      const [name, durationStr] = payload.split("|");
      const toolCall: ToolCall = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: name || "unknown",
        status: "running",
        startedAt: Date.now() - (Number(durationStr) || 0) * 1000,
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
    const elapsed = Date.now() - activeRun.startTime;
    const sections: string[] = [];

    // 头部状态栏
    sections.push(`╔══════════════════════════════════════╗`);
    sections.push(`║  🤖 Claude Code ${this.phaseBadge(activeRun.phase).padEnd(24)} ║`);
    sections.push(`╠══════════════════════════════════════╣`);

    // 基本信息
    sections.push(`║  ⏱️  ${this.formatDuration(elapsed).padEnd(33)}║`);
    sections.push(`║  📁 ${shorten(activeRun.workspaceName, 30).padEnd(33)} ║`);
    sections.push(`║  📝 ${shorten(activeRun.runId.slice(0, 8), 30).padEnd(33)} ║`);
    sections.push(`╠══════════════════════════════════════╣`);

    // 当前状态
    const phaseLine = `║  ${this.phaseBadge(activeRun.phase)} ${activeRun.phase}`;
    sections.push(`${phaseLine.padEnd(38)} ║`);

    // 正在使用的工具
    if (activeRun.currentToolCall) {
      sections.push(`╠──────────────────────────────────────╣`);
      sections.push(
        `║  🔧 Current Tool: ${shorten(activeRun.currentToolCall.name, 22).padEnd(24)} ║`,
      );
      const toolDuration = this.formatDuration(Date.now() - activeRun.currentToolCall.startedAt);
      sections.push(`║     Running for: ${toolDuration.padEnd(21)} ║`);
    }

    // 等待审批
    if (activeRun.approvalState) {
      sections.push(`╠──────────────────────────────────────╣`);
      sections.push(`║  🛂 Approval: ${shorten(activeRun.approvalState, 24).padEnd(24)} ║`);
    }

    // 工具调用历史
    if (activeRun.toolCalls.length > 0) {
      sections.push(`╠══════════════════════════════════════╣`);
      sections.push(`║  🛠️  Tool Calls (${activeRun.toolCalls.length}):${"".padEnd(17)} ║`);

      const completedTools = activeRun.toolCalls.filter((t) => t.status === "completed");
      const recentTools = completedTools.slice(-3);

      for (const tool of recentTools) {
        const statusIcon = "✅";
        const duration = tool.duration ? `(${tool.duration}s)` : "";
        const line = `║    ${statusIcon} ${shorten(tool.name, 18)} ${duration}`;
        sections.push(`${line.padEnd(38)} ║`);

        if (tool.result) {
          const resultPreview = shorten(tool.result, 25);
          const resultLine = `║       → ${resultPreview}`;
          sections.push(`${resultLine.padEnd(38)} ║`);
        }
      }

      if (completedTools.length > recentTools.length) {
        const more = completedTools.length - recentTools.length;
        sections.push(`║    ... and ${more} more${"".padEnd(21)} ║`);
      }
    }

    sections.push(`╚══════════════════════════════════════╝`);

    return sections.join("\n");
  }

  private renderInitialProgressText(runId: string, workspaceName: string): string {
    const sections: string[] = [];
    sections.push(`╔══════════════════════════════════════╗`);
    sections.push(`║  🤖 Claude Code 🚀 Starting...       ║`);
    sections.push(`╠══════════════════════════════════════╣`);
    sections.push(`║  📁 ${shorten(workspaceName, 30).padEnd(33)} ║`);
    sections.push(`║  📝 ${runId.slice(0, 8).padEnd(33)} ║`);
    sections.push(`╠══════════════════════════════════════╣`);
    sections.push(`║  ⏳ Initializing session...          ║`);
    sections.push(`╚══════════════════════════════════════╝`);
    return sections.join("\n");
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
}
