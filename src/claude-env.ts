import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { AppConfig } from "./config.ts";

type Release = () => void;

let envLock: Promise<void> = Promise.resolve();

function buildClaudeEnvEntries(config: AppConfig): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  const claudeConfigDir = process.env.CLAUDE_CONFIG_DIR || resolve(config.workspaceRoot, ".claude");

  if (config.claudeCodeOauthToken) {
    entries.push(["CLAUDE_CODE_OAUTH_TOKEN", config.claudeCodeOauthToken]);
  }
  if (config.anthropicApiKey) {
    entries.push(["ANTHROPIC_API_KEY", config.anthropicApiKey]);
  }
  if (config.anthropicBaseUrl) {
    entries.push(["ANTHROPIC_BASE_URL", config.anthropicBaseUrl]);
  }
  if (config.anthropicAuthToken) {
    entries.push(["ANTHROPIC_AUTH_TOKEN", config.anthropicAuthToken]);
  }
  if (config.claudeModel) {
    entries.push(["ANTHROPIC_MODEL", config.claudeModel]);
  }
  entries.push(["CLAUDE_CONFIG_DIR", claudeConfigDir]);
  return entries;
}

async function withEnvLock<T>(fn: () => Promise<T>): Promise<T> {
  let release!: Release;
  const acquired = new Promise<void>((resolve) => {
    release = resolve;
  });
  const previous = envLock;
  envLock = acquired;
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

export async function withClaudeEnv<T>(config: AppConfig, fn: () => Promise<T>): Promise<T> {
  return await withEnvLock(async () => {
    const entries = buildClaudeEnvEntries(config);
    const saved = new Map<string, string | undefined>();

    const claudeConfigDir = entries.find(([key]) => key === "CLAUDE_CONFIG_DIR")?.[1];
    if (claudeConfigDir) {
      mkdirSync(claudeConfigDir, { recursive: true });
      mkdirSync(resolve(claudeConfigDir, "debug"), { recursive: true });
    }

    for (const [key, value] of entries) {
      saved.set(key, process.env[key]);
      process.env[key] = value;
    }

    try {
      return await fn();
    } finally {
      for (const [key, value] of saved.entries()) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });
}
