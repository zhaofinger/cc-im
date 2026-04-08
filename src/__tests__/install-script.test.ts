import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

  test("runs main when executed from stdin", () => {
    const homeDir = join(tempDir, "home");
    const result = Bun.spawnSync({
      cmd: [
        "bash",
        "-lc",
        `HOME="${homeDir}" CC_IM_INSTALL_NONINTERACTIVE=1 bash < "${scriptPath}"`,
      ],
      cwd: repoRoot,
      env: {
        ...process.env,
      },
    });

    const output = `${result.stdout.toString()}\n${result.stderr.toString()}`;
    expect(output).toContain("This script will:");
    expect(output).toContain("Continuing immediately");
  });

  test("passes custom registry to bun install", () => {
    const installDir = join(tempDir, "install");
    const fakeBinDir = join(tempDir, "bin");
    const envLogPath = join(tempDir, "bun-env.log");
    mkdirSync(installDir, { recursive: true });
    mkdirSync(fakeBinDir, { recursive: true });
    writeFileSync(
      join(fakeBinDir, "bun"),
      `#!/bin/bash
echo "registry=$NPM_CONFIG_REGISTRY" > "${envLogPath}"
exit 0
`,
    );
    chmodSync(join(fakeBinDir, "bun"), 0o755);

    const result = Bun.spawnSync({
      cmd: [
        "bash",
        "-lc",
        `export PATH="${fakeBinDir}:$PATH"; source "${scriptPath}"; INSTALL_DIR="${installDir}"; CC_IM_NPM_REGISTRY="https://registry.npmmirror.com" install_deps`,
      ],
      cwd: repoRoot,
      env: process.env,
    });

    expect(result.exitCode).toBe(0);
    expect(readFileSync(envLogPath, "utf8")).toContain("registry=https://registry.npmmirror.com");
  });

  test("surfaces bun install failure output directly", () => {
    const installDir = join(tempDir, "install");
    const fakeBinDir = join(tempDir, "bin");
    mkdirSync(installDir, { recursive: true });
    mkdirSync(fakeBinDir, { recursive: true });
    writeFileSync(
      join(fakeBinDir, "bun"),
      `#!/bin/bash
echo "error: UNKNOWN_CERTIFICATE_VERIFICATION_ERROR downloading tarball markdown-it@14.1.1"
exit 1
`,
    );
    chmodSync(join(fakeBinDir, "bun"), 0o755);

    const result = Bun.spawnSync({
      cmd: [
        "bash",
        "-lc",
        `export PATH="${fakeBinDir}:$PATH"; source "${scriptPath}"; INSTALL_DIR="${installDir}"; install_deps`,
      ],
      cwd: repoRoot,
      env: process.env,
    });

    const output = `${result.stdout.toString()}\n${result.stderr.toString()}`;
    expect(result.exitCode).toBe(1);
    expect(output).toContain("Dependency installation failed.");
    expect(output).toContain("UNKNOWN_CERTIFICATE_VERIFICATION_ERROR");
  });
});
