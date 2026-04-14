import { readdirSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export function isWorkspaceDirName(name: string): boolean {
  if (name.startsWith(".")) {
    return false;
  }
  return name !== "node_modules" && name !== "logs";
}

export function listWorkspaceNames(workspaceRoot: string): string[] {
  return readdirSync(workspaceRoot)
    .filter((name) => {
      if (!isWorkspaceDirName(name)) {
        return false;
      }
      const fullPath = join(workspaceRoot, name);
      return statSync(fullPath).isDirectory();
    })
    .sort((left, right) => left.localeCompare(right));
}

export function firstWorkspaceCandidate(workspaceRoot: string): string | undefined {
  const names = listWorkspaceNames(workspaceRoot);
  return names[0] ? join(workspaceRoot, names[0]) : undefined;
}

export function resolveWorkspacePath(workspaceRoot: string, workspaceName: string): string {
  const normalized = resolve(workspaceRoot, workspaceName);
  const root = resolve(workspaceRoot);
  if (!normalized.startsWith(`${root}/`) && normalized !== root) {
    throw new Error("Workspace escapes configured root");
  }
  const stats = statSync(normalized);
  if (!stats.isDirectory()) {
    throw new Error("Workspace is not a directory");
  }
  // Return the real path (resolves symlinks) for consistent comparison
  return realpathSync(normalized);
}
