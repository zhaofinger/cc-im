/**
 * Claude/Codex 环境变量管理
 * CLI 工具自己处理认证，这里只需设置基本路径
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { AppConfig } from "./config.ts";

/**
 * 确保配置目录存在
 */
export function ensureClaudeConfigDir(configDir: string): void {
  mkdirSync(dirname(configDir), { recursive: true });
}

/**
 * 在 Claude/Codex 环境中执行函数
 * 简化版：CLI 自己管理环境变量
 */
export async function withClaudeEnv<T>(_config: AppConfig, fn: () => Promise<T>): Promise<T> {
  // CLI 工具会自己读取环境变量和配置文件
  // 不再需要复杂的 env 设置
  return await fn();
}
