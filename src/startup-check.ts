import { statSync } from "node:fs";
import type { AppConfig } from "./config.ts";
import type { Logger } from "./logger.ts";
import type { TelegramApi } from "./telegram/api.ts";
import { ClaudeCliRunner } from "./agent/claude-cli.ts";
import { CodexCliRunner } from "./agent/codex-cli.ts";
import { firstWorkspaceCandidate } from "./utils/workspace.ts";

export async function runStartupChecks(args: {
  config: AppConfig;
  telegram: TelegramApi;
  logger: Logger;
}): Promise<void> {
  const { config, telegram, logger } = args;

  logger.info("startup check: telegram");
  const botInfo = await telegram.getMe();
  logger.info("startup check passed: telegram", {
    username: botInfo.username,
    id: botInfo.id,
  });

  logger.info("startup check: workspace root");
  const workspaceRootStats = statSync(config.workspaceRoot);
  if (!workspaceRootStats.isDirectory()) {
    throw new Error(`WORKSPACE_ROOT is not a directory: ${config.workspaceRoot}`);
  }
  const probeWorkspace = firstWorkspaceCandidate(config.workspaceRoot);
  logger.info("startup check passed: workspace root", {
    workspaceRoot: config.workspaceRoot,
    firstWorkspace: probeWorkspace || null,
  });

  logger.info("startup check: agent cli");
  const runner = config.agentProvider === "codex" ? new CodexCliRunner() : new ClaudeCliRunner();

  const isInstalled = await runner.checkInstalled();
  if (!isInstalled) {
    throw new Error(`${runner.name} CLI is not installed. Please install it first.`);
  }

  logger.info("startup check passed: agent cli", {
    provider: config.agentProvider,
    installed: true,
  });
}
