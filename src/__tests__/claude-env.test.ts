import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { withClaudeEnv } from "../claude-env.ts";
import type { AppConfig } from "../config.ts";

describe("withClaudeEnv", () => {
  const originalEnv = { ...process.env };
  let testConfig: AppConfig;
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `cc-im-claude-env-${Date.now()}`);
    testConfig = {
      telegramBotToken: "test-token",
      workspaceRoot: testDir,
      logDir: join(testDir, "logs"),
      claudePermissionMode: "default",
      claudeCommandsPageSize: 8,
    };
  });

  afterEach(() => {
    // Restore original env
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);

    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  test("should set CLAUDE_CONFIG_DIR env var", async () => {
    await withClaudeEnv(testConfig, async () => {
      expect(process.env.CLAUDE_CONFIG_DIR).toBe(join(testDir, ".claude"));
    });
  });

  test("should create CLAUDE_CONFIG_DIR directory", async () => {
    await withClaudeEnv(testConfig, async () => {});
    const stats = statSync(join(testDir, ".claude"));
    expect(stats.isDirectory()).toBe(true);
  });

  test("should create debug subdirectory", async () => {
    await withClaudeEnv(testConfig, async () => {});
    const stats = statSync(join(testDir, ".claude", "debug"));
    expect(stats.isDirectory()).toBe(true);
  });

  test("should set ANTHROPIC_MODEL when claudeModel is configured", async () => {
    testConfig.claudeModel = "claude-sonnet-4-6";
    await withClaudeEnv(testConfig, async () => {
      expect(process.env.ANTHROPIC_MODEL).toBe("claude-sonnet-4-6");
    });
  });

  test("should set CLAUDE_CODE_OAUTH_TOKEN when configured", async () => {
    testConfig.claudeCodeOauthToken = "oauth-token-123";
    await withClaudeEnv(testConfig, async () => {
      expect(process.env.CLAUDE_CODE_OAUTH_TOKEN).toBe("oauth-token-123");
    });
  });

  test("should set ANTHROPIC_API_KEY when configured", async () => {
    testConfig.anthropicApiKey = "api-key-456";
    await withClaudeEnv(testConfig, async () => {
      expect(process.env.ANTHROPIC_API_KEY).toBe("api-key-456");
    });
  });

  test("should set ANTHROPIC_BASE_URL when configured", async () => {
    testConfig.anthropicBaseUrl = "https://custom.api.com";
    await withClaudeEnv(testConfig, async () => {
      expect(process.env.ANTHROPIC_BASE_URL).toBe("https://custom.api.com");
    });
  });

  test("should set ANTHROPIC_AUTH_TOKEN when configured", async () => {
    testConfig.anthropicAuthToken = "auth-token-789";
    await withClaudeEnv(testConfig, async () => {
      expect(process.env.ANTHROPIC_AUTH_TOKEN).toBe("auth-token-789");
    });
  });

  test("should use existing CLAUDE_CONFIG_DIR from env", async () => {
    const customDir = join(testDir, "custom", "config");
    process.env.CLAUDE_CONFIG_DIR = customDir;
    await withClaudeEnv(testConfig, async () => {
      expect(process.env.CLAUDE_CONFIG_DIR).toBe(customDir);
    });
  });

  test("should restore original env after execution", async () => {
    process.env.ANTHROPIC_API_KEY = "original-key";
    testConfig.anthropicApiKey = "new-key";

    await withClaudeEnv(testConfig, async () => {
      expect(process.env.ANTHROPIC_API_KEY).toBe("new-key");
    });

    expect(process.env.ANTHROPIC_API_KEY).toBe("original-key");
  });

  test("should restore env even when function throws", async () => {
    process.env.ANTHROPIC_API_KEY = "original-key";
    testConfig.anthropicApiKey = "new-key";

    try {
      await withClaudeEnv(testConfig, async () => {
        expect(process.env.ANTHROPIC_API_KEY).toBe("new-key");
        throw new Error("test error");
      });
    } catch (e) {
      // Expected error
    }

    expect(process.env.ANTHROPIC_API_KEY).toBe("original-key");
  });

  test("should handle undefined env vars that were not set", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    testConfig.anthropicApiKey = "temp-key";

    await withClaudeEnv(testConfig, async () => {});

    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  test("should return function result", async () => {
    const result = await withClaudeEnv(testConfig, async () => {
      return "success";
    });
    expect(result).toBe("success");
  });

  test("should handle synchronous function", async () => {
    const result = await withClaudeEnv(testConfig, () => {
      return Promise.resolve("sync result");
    });
    expect(result).toBe("sync result");
  });

  test("should serialize concurrent calls", async () => {
    const executionOrder: number[] = [];

    const promise1 = withClaudeEnv(testConfig, async () => {
      executionOrder.push(1);
      await new Promise((resolve) => setTimeout(resolve, 50));
      executionOrder.push(2);
      return "first";
    });

    const promise2 = withClaudeEnv(testConfig, async () => {
      executionOrder.push(3);
      await new Promise((resolve) => setTimeout(resolve, 10));
      executionOrder.push(4);
      return "second";
    });

    const [result1, result2] = await Promise.all([promise1, promise2]);

    expect(result1).toBe("first");
    expect(result2).toBe("second");
    // Due to locking, they should execute sequentially
    expect(executionOrder).toEqual([1, 2, 3, 4]);
  });

  test("should handle all auth options together", async () => {
    testConfig.anthropicApiKey = "api-key";
    testConfig.anthropicBaseUrl = "https://api.com";
    testConfig.anthropicAuthToken = "auth-token";
    testConfig.claudeCodeOauthToken = "oauth-token";
    testConfig.claudeModel = "model-name";

    await withClaudeEnv(testConfig, async () => {
      expect(process.env.ANTHROPIC_API_KEY).toBe("api-key");
      expect(process.env.ANTHROPIC_BASE_URL).toBe("https://api.com");
      expect(process.env.ANTHROPIC_AUTH_TOKEN).toBe("auth-token");
      expect(process.env.CLAUDE_CODE_OAUTH_TOKEN).toBe("oauth-token");
      expect(process.env.ANTHROPIC_MODEL).toBe("model-name");
    });
  });

  test("should not set unset optional env vars when config values are undefined", async () => {
    // Clear any existing env vars first
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    delete process.env.ANTHROPIC_MODEL;

    // Ensure config values are undefined
    const cleanConfig: AppConfig = {
      ...testConfig,
      anthropicApiKey: undefined,
      anthropicBaseUrl: undefined,
      anthropicAuthToken: undefined,
      claudeCodeOauthToken: undefined,
      claudeModel: undefined,
    };

    await withClaudeEnv(cleanConfig, async () => {
      expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(process.env.ANTHROPIC_BASE_URL).toBeUndefined();
      expect(process.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
      expect(process.env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
      expect(process.env.ANTHROPIC_MODEL).toBeUndefined();
    });
  });

  test("should handle deeply nested custom config dir", async () => {
    process.env.CLAUDE_CONFIG_DIR = join(testDir, "very", "deeply", "nested", "path");
    await withClaudeEnv(testConfig, async () => {});
    const stats = statSync(join(testDir, "very", "deeply", "nested", "path", "debug"));
    expect(stats.isDirectory()).toBe(true);
  });
});
