import {
  checkCliInstalled,
  createSpawnSession,
  type CliRunOptions,
  type CliRunSession,
  type CliRunner,
} from "./cli-runner.ts";

export class CodexCliRunner implements CliRunner {
  readonly name = "codex";

  async checkInstalled(): Promise<boolean> {
    return checkCliInstalled(this.name);
  }

  run(options: CliRunOptions): CliRunSession {
    const args: string[] = [];
    if (options.prompt) {
      args.push("-q", options.prompt);
    }
    if (options.mode === "bypassPermissions") {
      args.push("--full-auto");
    }
    return createSpawnSession(this.name, args, options, "ignore");
  }

  async probeSlashCommands(_workspacePath: string): Promise<string[]> {
    return [];
  }
}
