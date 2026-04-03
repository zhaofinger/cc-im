import { mkdirSync } from "node:fs";
import { appendFileSync } from "node:fs";
import { join } from "node:path";

export class Logger {
  constructor(private readonly logDir: string) {
    mkdirSync(logDir, { recursive: true });
  }

  info(message: string, details?: unknown): void {
    this.write("info", message, details);
  }

  error(message: string, details?: unknown): void {
    this.write("error", message, details);
  }

  run(runId: string, message: string, details?: unknown): void {
    const line = this.format("run", message, details);
    appendFileSync(join(this.logDir, `${runId}.log`), line);
  }

  private write(level: string, message: string, details?: unknown): void {
    const line = this.format(level, message, details);
    appendFileSync(join(this.logDir, "app.log"), line);
    if (level === "error") {
      console.error(line.trim());
      return;
    }
    console.log(line.trim());
  }

  private format(level: string, message: string, details?: unknown): string {
    const payload =
      details === undefined ? "" : ` ${JSON.stringify(details, null, 0)}`;
    return `${new Date().toISOString()} [${level}] ${message}${payload}\n`;
  }
}
