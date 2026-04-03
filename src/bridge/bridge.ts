import { randomUUID } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
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

type ActiveRunRecord = {
  runId: string;
  progressMessageId: number;
  stop: () => void;
  contentDraftId: number;
  accumulatedText: string;
  lastFlushedText: string;
  progressText: string;
  progressHistory: string[];
  phase: string;
  currentTool?: string;
  lastToolResult?: string;
  approvalState?: string;
  lastProgressFlushedText: string;
  flushTimer?: Timer;
  progressFlushTimer?: Timer;
  typingTimer?: Timer;
  sessionId: string;
  workspacePath: string;
  workspaceName: string;
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function markdownToTelegramHtml(md: string): string {
  const codeBlocks: string[] = [];
  let text = md.replace(/```[\s\S]*?```/g, (match) => {
    const code = match.replace(/^```\w*\n?/, "").replace(/\n?```$/, "");
    codeBlocks.push(`<pre><code>${escapeHtml(code)}</code></pre>`);
    return `\x00CB${codeBlocks.length - 1}\x00`;
  });

  const inlineCodes: string[] = [];
  text = text.replace(/`([^`]+)`/g, (_, code: string) => {
    inlineCodes.push(`<code>${escapeHtml(code)}</code>`);
    return `\x00IC${inlineCodes.length - 1}\x00`;
  });

  text = escapeHtml(text);
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  text = text.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  text = text.replace(/__(.+?)__/g, "<b>$1</b>");
  text = text.replace(/~~(.+?)~~/g, "<s>$1</s>");
  text = text.replace(/(?<!\w)\*(?!\s)(.+?)(?<!\s)\*(?!\w)/g, "<i>$1</i>");
  text = text.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");

  text = text.replace(/\x00CB(\d+)\x00/g, (_, i) => codeBlocks[Number(i)] || "");
  text = text.replace(/\x00IC(\d+)\x00/g, (_, i) => inlineCodes[Number(i)] || "");
  return text;
}

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
    const workspaces = this.listWorkspaceNames();
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
    const workspacePath = this.resolveWorkspacePath(workspaceName);
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

  private async showClaudeMenu(chatId: number, page: number, editMessageId?: number): Promise<void> {
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
      await this.telegram.sendMessage(chatId, "A run is already in progress. Use /stop or wait for it to finish.");
      return;
    }

    const workspacePath = state.selectedWorkspace;
    const workspaceName = state.selectedWorkspaceName;
    const existingSession = this.state.getWorkspaceSession(workspacePath);
    const runId = randomUUID();
    const progressMessageId = await this.telegram.sendMessage(
      chatId,
      FormattedString.pre(this.renderProgressText({
        runId,
        progressMessageId: 0,
        stop: () => {},
        contentDraftId: draftId || 1,
        accumulatedText: "",
        lastFlushedText: "",
        progressText: "",
        progressHistory: [],
        phase: "Thinking",
        lastProgressFlushedText: "",
        sessionId: existingSession?.sessionId || randomUUID(),
        workspacePath,
        workspaceName,
      })),
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
      progressHistory: [],
      phase: "Thinking",
      lastProgressFlushedText: "",
      sessionId: existingSession?.sessionId || randomUUID(),
      workspacePath,
      workspaceName,
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
        this.pushProgress(chatId, "phase:Completed");
        await this.flushProgressMessage(chatId, true);
        await this.flushContentMessage(chatId, true);
        this.stopTypingIndicator(activeRun);
        this.state.setActiveRun(chatId);
        this.activeRuns.delete(chatId);
        return;
      }
      case "run_failed": {
        this.pushProgress(chatId, `phase:Failed`);
        this.pushProgress(chatId, `event:${args.event.message}`);
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
    const clipped = this.clipForTelegram(text);
    if (!force && clipped === activeRun.lastFlushedText) {
      return;
    }
    activeRun.lastFlushedText = clipped;
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
    if (activeRun.progressHistory[activeRun.progressHistory.length - 1] === clean) {
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
    const clipped = this.clipForTelegram(activeRun.progressText);
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
    if (line.startsWith("phase:")) {
      activeRun.phase = line.slice(6).trim();
      return;
    }
    if (line.startsWith("approval:")) {
      activeRun.approvalState = line.slice(9).trim();
      activeRun.progressHistory.push(activeRun.approvalState);
      activeRun.progressHistory = activeRun.progressHistory.slice(-5);
      return;
    }
    if (line.startsWith("Tool: ")) {
      activeRun.currentTool = line.slice(6).trim();
      activeRun.phase = "Using tool";
      return;
    }
    if (line.startsWith("Tool result: ")) {
      activeRun.lastToolResult = line.slice(13).trim();
      activeRun.phase = "Processing result";
      activeRun.progressHistory.push(`Result: ${activeRun.lastToolResult}`);
      activeRun.progressHistory = activeRun.progressHistory.slice(-5);
      return;
    }
    if (line === "Thinking...") {
      activeRun.phase = "Thinking";
      return;
    }
    if (line.startsWith("Claude session ready:")) {
      activeRun.phase = "Ready";
      activeRun.progressHistory.push("Session ready");
      activeRun.progressHistory = activeRun.progressHistory.slice(-5);
      return;
    }
    if (line.startsWith("Command output: ")) {
      const output = line.slice(16).trim();
      activeRun.lastToolResult = output;
      activeRun.progressHistory.push(`Output: ${output}`);
      activeRun.progressHistory = activeRun.progressHistory.slice(-5);
      return;
    }
    if (line.startsWith("Claude status: ")) {
      activeRun.phase = line.slice(15).trim() || activeRun.phase;
      return;
    }
    if (line.startsWith("event:")) {
      const event = line.slice(6).trim();
      activeRun.progressHistory.push(event);
      activeRun.progressHistory = activeRun.progressHistory.slice(-5);
      return;
    }

    activeRun.progressHistory.push(line);
    activeRun.progressHistory = activeRun.progressHistory.slice(-5);
  }

  private renderProgressText(activeRun: ActiveRunRecord): string {
    const lines = [
      `📡 CC-IM Status ${this.phaseBadge(activeRun.phase)}`,
      "",
      `📁 Workspace: ${activeRun.workspaceName}`,
      `🧠 Phase: ${activeRun.phase}`,
    ];

    if (activeRun.currentTool) {
      lines.push(`🛠 Tool: ${this.shorten(activeRun.currentTool, 80)}`);
    }

    if (activeRun.approvalState) {
      lines.push(`🛂 Approval: ${this.shorten(activeRun.approvalState, 80)}`);
    }

    if (activeRun.lastToolResult) {
      lines.push("");
      lines.push("📎 Last Result");
      lines.push(this.shorten(activeRun.lastToolResult, 220));
    }

    if (activeRun.progressHistory.length > 0) {
      lines.push("");
      lines.push("🕒 Recent");
      for (const item of activeRun.progressHistory) {
        lines.push(`• ${this.shorten(item, 120)}`);
      }
    }

    return lines.join("\n");
  }

  private isAllowedChat(chatId: number): boolean {
    if (!this.config.telegramAllowedChatId) {
      return true;
    }
    return this.config.telegramAllowedChatId === chatId;
  }

  private isWorkspaceDirName(name: string): boolean {
    if (name.startsWith(".")) {
      return false;
    }
    return name !== "node_modules" && name !== "logs";
  }

  private listWorkspaceNames(): string[] {
    return readdirSync(this.config.workspaceRoot)
      .filter((name) => {
        if (!this.isWorkspaceDirName(name)) {
          return false;
        }
        const fullPath = join(this.config.workspaceRoot, name);
        return statSync(fullPath).isDirectory();
      })
      .sort((left, right) => left.localeCompare(right));
  }

  private resolveWorkspacePath(workspaceName: string): string {
    const normalized = resolve(this.config.workspaceRoot, workspaceName);
    const root = resolve(this.config.workspaceRoot);
    if (!normalized.startsWith(`${root}/`) && normalized !== root) {
      throw new Error("Workspace escapes configured root");
    }
    const stats = statSync(normalized);
    if (!stats.isDirectory()) {
      throw new Error("Workspace is not a directory");
    }
    return normalized;
  }

  private clipForTelegram(text: string): string {
    const maxLen = 3900;
    if (text.length <= maxLen) {
      return text;
    }
    return `${text.slice(0, maxLen - 15)}\n\n_[truncated]_`;
  }

  private shorten(text: string, maxLen: number): string {
    if (text.length <= maxLen) {
      return text;
    }
    return `${text.slice(0, maxLen - 3)}...`;
  }

  private phaseBadge(phase: string): string {
    switch (phase.toLowerCase()) {
      case "thinking":
        return "[thinking]";
      case "ready":
        return "[ready]";
      case "using tool":
        return "[tool]";
      case "processing result":
        return "[result]";
      case "completed":
        return "[done]";
      case "failed":
        return "[failed]";
      default:
        return "[active]";
    }
  }

}
