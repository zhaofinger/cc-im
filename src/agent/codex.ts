import type { AgentAdapter, CommandProbe } from "./types.ts";

export class CodexAdapter implements AgentAdapter {
  async probeSlashCommands(): Promise<CommandProbe> {
    return { slashCommands: [] };
  }

  async sendMessage(): Promise<{ sessionId: string; stop: () => void }> {
    throw new Error("CodexAdapter is not implemented yet");
  }
}
