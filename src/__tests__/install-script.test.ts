import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");
const scriptPath = join(repoRoot, "install.sh");

describe("install.sh", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cc-im-install-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("continues past confirmation when interactive input is unavailable", () => {
    const result = Bun.spawnSync({
      cmd: [
        "bash",
        "-lc",
        `source "${scriptPath}"; CC_IM_INSTALL_NONINTERACTIVE=1; wait_for_confirmation`,
      ],
      cwd: repoRoot,
      env: {
        ...process.env,
        CC_IM_INSTALL_NONINTERACTIVE: "1",
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("Continuing immediately");
  });

  test("creates .env from environment variables in non-interactive mode", () => {
    const installDir = join(tempDir, ".cc-im");
    const workspaceRoot = join(tempDir, "workspace");
    const logDir = join(tempDir, "logs");
    const result = Bun.spawnSync({
      cmd: [
        "bash",
        "-lc",
        `source "${scriptPath}"; INSTALL_DIR="${installDir}"; mkdir -p "$INSTALL_DIR"; setup_env`,
      ],
      cwd: repoRoot,
      env: {
        ...process.env,
        CC_IM_INSTALL_NONINTERACTIVE: "1",
        TELEGRAM_BOT_TOKEN: "test-token",
        TELEGRAM_ALLOWED_CHAT_ID: "123456",
        WORKSPACE_ROOT: workspaceRoot,
        LOG_DIR: logDir,
      },
    });

    expect(result.exitCode).toBe(0);

    const envFile = join(installDir, ".env");
    expect(existsSync(envFile)).toBe(true);

    const contents = readFileSync(envFile, "utf8");
    expect(contents).toContain("TELEGRAM_BOT_TOKEN=test-token");
    expect(contents).toContain("TELEGRAM_ALLOWED_CHAT_ID=123456");
    expect(contents).toContain(`WORKSPACE_ROOT=${workspaceRoot}`);
    expect(contents).toContain(`LOG_DIR=${logDir}`);
  });
});
