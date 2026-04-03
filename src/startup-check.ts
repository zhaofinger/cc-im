import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "./config.ts";
import type { Logger } from "./logger.ts";
import type { TelegramApi } from "./telegram/api.ts";

function isWorkspaceDirName(name: string): boolean {
  if (name.startsWith(".")) {
    return false;
  }
  return name !== "node_modules" && name !== "logs";
}

function firstWorkspaceCandidate(workspaceRoot: string): string | undefined {
  const entries = readdirSync(workspaceRoot)
    .filter((name) => {
      if (!isWorkspaceDirName(name)) {
        return false;
      }
      try {
        return statSync(join(workspaceRoot, name)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort((left, right) => left.localeCompare(right));

  return entries[0] ? join(workspaceRoot, entries[0]) : undefined;
}

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

  logger.info("startup check: claude");
  logger.info("startup check passed: claude", {
    authConfigured: Boolean(
      config.anthropicApiKey ||
        config.anthropicAuthToken ||
        config.claudeCodeOauthToken,
    ),
    provider: config.anthropicBaseUrl ? "custom-base-url" : config.anthropicApiKey ? "api-key" : config.claudeCodeOauthToken ? "oauth-token" : "unknown",
    note: "Deep Claude verification is deferred until the first real conversation",
  });
}
