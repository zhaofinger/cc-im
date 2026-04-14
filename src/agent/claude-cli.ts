import { closeSync, openSync, readSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import {
  checkCliInstalled,
  createSpawnSession,
  type CliRunOptions,
  type CliRunSession,
  type CliRunner,
} from "./cli-runner.ts";

export type ClaudeSession = {
  sessionId: string;
  startedAt: number;
  sizeBytes: number;
  summary: string;
};

export class ClaudeCliRunner implements CliRunner {
  readonly name = "claude";

  async checkInstalled(): Promise<boolean> {
    return checkCliInstalled(this.name);
  }

  run(options: CliRunOptions): CliRunSession {
    return createSpawnSession(this.name, buildClaudeCliArgs(options), options);
  }

  async probeSlashCommands(workspacePath: string): Promise<string[]> {
    try {
      const proc = Bun.spawn({
        cmd: [
          "claude",
          "-p",
          "--input-format",
          "stream-json",
          "--output-format",
          "stream-json",
          "--verbose",
          "--include-hook-events",
          "--replay-user-messages",
          "--permission-mode",
          "default",
        ],
        cwd: workspacePath,
        env: process.env,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "ignore",
      });

      proc.stdin.write(
        `${JSON.stringify({
          type: "user",
          message: { role: "user", content: "hello" },
          parent_tool_use_id: null,
          session_id: "",
        })}\n`,
      );
      proc.stdin.end();

      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const commands = parseSlashCommandsFromInitLine(line);
          if (commands) {
            proc.kill();
            return commands;
          }
        }
      }
      return parseSlashCommandsFromInitLine(buffer) || [];
    } catch (error) {
      console.error("Failed to probe slash commands:", error);
      return [];
    }
  }

  getSessionDir(workspacePath: string): string {
    return join(workspacePath, ".claude", "sessions");
  }

  listAvailableSessions(workspacePath: string): ClaudeSession[] {
    try {
      const sessionsDir = getClaudeProjectDir(workspacePath);
      const files = readdirSync(sessionsDir);
      const sessions: ClaudeSession[] = [];

      for (const file of files) {
        if (!file.endsWith(".jsonl")) continue;
        try {
          const sessionPath = join(sessionsDir, file);
          const fileStats = statSync(sessionPath);
          const sessionId = file.slice(0, -".jsonl".length);
          const summary = extractSessionSummaryFromTranscript(sessionPath);
          sessions.push({
            sessionId,
            startedAt: fileStats.mtimeMs,
            sizeBytes: fileStats.size,
            summary,
          });
        } catch {
          // Skip invalid session files
        }
      }

      return sessions.sort((a, b) => b.startedAt - a.startedAt);
    } catch {
      return [];
    }
  }
}

export function buildClaudeCliArgs(options: CliRunOptions): string[] {
  const args: string[] = [];

  if (options.sessionId) {
    args.push("--resume", options.sessionId);
  }

  if (options.debugFile) {
    args.push("--debug-file", options.debugFile);
  }

  args.push("-p");
  args.push("--input-format", "stream-json");
  args.push("--output-format", "stream-json");
  args.push("--verbose");
  args.push("--include-hook-events");
  args.push("--replay-user-messages");
  args.push("--permission-mode", options.mode);

  return args;
}

const MAX_SANITIZED_PATH_LENGTH = 200;
const TRANSCRIPT_PREVIEW_BYTES = 64 * 1024;

export function getClaudeProjectDir(workspacePath: string): string {
  return resolve(homedir(), ".claude", "projects", sanitizeClaudePath(realpathSync(workspacePath)));
}

export function sanitizeClaudePath(path: string): string {
  const sanitized = path.replace(/[^a-zA-Z0-9]/g, "-");
  return sanitized.length <= MAX_SANITIZED_PATH_LENGTH
    ? sanitized
    : sanitized.slice(0, MAX_SANITIZED_PATH_LENGTH);
}

export function extractSessionSummaryFromTranscript(transcriptPath: string): string {
  const fd = openSync(transcriptPath, "r");
  const buffer = Buffer.alloc(TRANSCRIPT_PREVIEW_BYTES);
  try {
    const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
    return extractSessionSummaryFromChunk(buffer.toString("utf8", 0, bytesRead));
  } finally {
    closeSync(fd);
  }
}

export function extractSessionSummaryFromChunk(chunk: string): string {
  for (const line of chunk.split("\n")) {
    if (!line.includes('"type":"user"') && !line.includes('"type": "user"')) {
      continue;
    }
    if (line.includes('"tool_result"')) {
      continue;
    }

    try {
      const parsed = JSON.parse(line) as {
        type?: string;
        message?: { content?: string | Array<{ type?: string; text?: string }> };
      };
      if (parsed.type !== "user") {
        continue;
      }

      const summary = extractTextContent(parsed.message?.content);
      if (summary) {
        return summary.length > 80 ? `${summary.slice(0, 80).trim()}...` : summary;
      }
    } catch {
      continue;
    }
  }

  return "(session)";
}

function extractTextContent(
  content: string | Array<{ type?: string; text?: string }> | undefined,
): string {
  if (typeof content === "string") {
    return content.replace(/\s+/g, " ").trim();
  }

  if (!Array.isArray(content)) {
    return "";
  }

  for (const block of content) {
    if (block.type === "text" && block.text?.trim()) {
      return block.text.replace(/\s+/g, " ").trim();
    }
  }

  return "";
}

export function parseSlashCommandsFromInitLine(line: string): string[] | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed) as {
      type?: string;
      subtype?: string;
      slash_commands?: string[];
    };
    if (parsed.type !== "system" || parsed.subtype !== "init" || !parsed.slash_commands) {
      return undefined;
    }
    return parsed.slash_commands.map((command) => command.replace(/^\//, ""));
  } catch {
    return undefined;
  }
}
