/**
 * CLI Runner 抽象层
 * 统一 Claude Code 和 Codex CLI 的调用接口
 */

export interface CliRunOptions {
  /** 工作目录 */
  cwd: string;
  /** 提示词 */
  prompt: string;
  /** 会话 ID（用于恢复） */
  sessionId?: string;
  /** 运行模式 */
  mode: "dangerous" | "interactive";
  /** 环境变量 */
  env: Record<string, string>;
  /** 日志文件路径（用于调试） */
  debugFile?: string;
}

export interface CliRunSession {
  /** 标准输出流 */
  stdout: ReadableStream;
  /** 标准错误流 */
  stderr: ReadableStream;
  /** 杀死进程 */
  kill: () => void;
  /** 进程退出 Promise */
  exited: Promise<number>;
}

export interface CliRunner {
  /** CLI 工具名称 */
  readonly name: string;
  /** 检查 CLI 是否已安装 */
  checkInstalled(): Promise<boolean>;
  /** 运行 CLI */
  run(options: CliRunOptions): CliRunSession;
  /**
   * 探测 slash commands
   * 通过运行 /help 或读取会话信息
   */
  probeSlashCommands(workspacePath: string): Promise<string[]>;
}

/**
 * 生成 CLI 环境变量
 */
export function buildCliEnv(config: {
  claudeCodeOauthToken?: string;
  anthropicApiKey?: string;
  claudeModel?: string;
}): Record<string, string> {
  const env: Record<string, string> = {};

  if (config.claudeCodeOauthToken) {
    env.CLAUDE_CODE_OAUTH_TOKEN = config.claudeCodeOauthToken;
  }
  if (config.anthropicApiKey) {
    env.ANTHROPIC_API_KEY = config.anthropicApiKey;
  }
  if (config.claudeModel) {
    env.ANTHROPIC_MODEL = config.claudeModel;
  }

  return env;
}
