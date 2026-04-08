import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  chmodSync,
  cpSync,
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

  test("linux launcher prints usage only for help", () => {
    const homeDir = join(tempDir, "home");
    const serviceDir = join(homeDir, ".config", "systemd", "user");
    Bun.spawnSync({
      cmd: [
        "bash",
        "-lc",
        `mkdir -p "${serviceDir}" && touch "${join(serviceDir, "cc-im.service")}"`,
      ],
      cwd: repoRoot,
    });

    const result = Bun.spawnSync({
      cmd: [
        "bash",
        "-lc",
        [
          `HOME="${homeDir}"`,
          `INSTALL_DIR="${join(homeDir, ".cc-im")}"`,
          'OSTYPE="linux-gnu"',
          `source "${scriptPath}"`,
          "create_launcher",
          `cat "${join(homeDir, ".local", "bin", "cc-im")}"`,
        ].join("; "),
      ],
      cwd: repoRoot,
    });

    expect(result.exitCode).toBe(0);
    const launcher = result.stdout.toString();
    expect(launcher).toContain('""|--help|-h)');
    expect(launcher).toContain("status)\n            systemctl --user status cc-im --no-pager");
    expect(launcher).not.toContain(
      'if [[ -f "$HOME/.config/systemd/user/cc-im.service" ]]; then\n    echo "Usage:"',
    );
  });

  test("baseline bun is selected on x64 linux without avx2", () => {
    const result = Bun.spawnSync({
      cmd: [
        "bash",
        "-lc",
        [
          `source "${scriptPath}"`,
          'OSTYPE="linux-gnu"',
          "uname() { echo x86_64; }",
          "cpu_supports_avx2() { return 1; }",
          "if should_use_baseline_bun; then echo yes; else echo no; fi",
        ].join("; "),
      ],
      cwd: repoRoot,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString().trim()).toBe("yes");
  });

  test("user systemd install omits user and group directives", () => {
    const projectDir = join(tempDir, "project");
    const deployDir = join(projectDir, "deploy");
    const fakeBinDir = join(tempDir, "fake-bin");
    const homeDir = join(tempDir, "home");

    mkdirSync(deployDir, { recursive: true });
    mkdirSync(fakeBinDir, { recursive: true });
    mkdirSync(homeDir, { recursive: true });

    cpSync(join(repoRoot, "deploy", "install-service.sh"), join(deployDir, "install-service.sh"));
    cpSync(join(repoRoot, "deploy", "cc-im.service"), join(deployDir, "cc-im.service"));
    writeFileSync(
      join(projectDir, ".env"),
      "TELEGRAM_BOT_TOKEN=test\nTELEGRAM_ALLOWED_CHAT_ID=1\n",
    );

    writeFileSync(
      join(fakeBinDir, "bun"),
      '#!/bin/bash\nif [[ "$1" == "--version" ]]; then\n  echo 1.3.11\n  exit 0\nfi\nexit 0\n',
    );
    chmodSync(join(fakeBinDir, "bun"), 0o755);

    writeFileSync(join(fakeBinDir, "systemctl"), "#!/bin/bash\nexit 0\n");
    chmodSync(join(fakeBinDir, "systemctl"), 0o755);

    const result = Bun.spawnSync({
      cmd: [
        "bash",
        "-lc",
        `HOME="${homeDir}" PATH="${fakeBinDir}:$PATH" bash "${join(deployDir, "install-service.sh")}" --user`,
      ],
      cwd: projectDir,
      env: {
        ...process.env,
        HOME: homeDir,
        PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
        OSTYPE: "linux-gnu",
      },
    });

    expect(result.exitCode).toBe(0);

    const serviceFile = join(homeDir, ".config", "systemd", "user", "cc-im.service");
    expect(existsSync(serviceFile)).toBe(true);

    const contents = readFileSync(serviceFile, "utf8");
    expect(contents).not.toContain("\nUser=");
    expect(contents).not.toContain("\nGroup=");
    expect(contents).toContain(`WorkingDirectory=${projectDir}`);
  });
});
