# cc-im

A Telegram bridge for Claude Code, built with Bun + TypeScript. Control Claude Code directly from Telegram!

<p align="center">
  <img src="https://img.shields.io/badge/Bun-%23000000.svg?style=for-the-badge&logo=bun&logoColor=white" alt="Bun">
  <img src="https://img.shields.io/badge/TypeScript-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Telegram-2CA5E0?style=for-the-badge&logo=telegram&logoColor=white" alt="Telegram">
</p>

---

## ✨ Features

- 🤖 **Seamless Claude Code Integration** - Control Claude Code remotely via Telegram
- 📁 **Workspace Management** - Select and switch between multiple workspaces
- 🔧 **Real-time Tool Tracking** - Visualize tool calls and their results in real-time
- 🛡️ **Secure Approval Flow** - Approve or reject sensitive operations from your phone
- 🛂 **Permission Modes** - Switch between default, accept-edits, plan, and bypass modes from Telegram
- 💬 **Interactive Commands** - Paginated slash command menu (/cc)
- 📝 **Session Persistence** - Maintains Claude sessions per workspace
- 🎨 **Beautiful Status Display** - Box-style status messages with emoji indicators

---

## 🚀 Quick Start

### Prerequisites

Before installation, you need:

- **Telegram Bot Token** - Get from [@BotFather](https://t.me/botfather)
- **Claude Code** - Installed and authenticated ([Installation Guide](https://github.com/anthropics/claude-code))
- **Bun-compatible CPU on x64 hosts** - If your Linux/macOS x64 server reports `Illegal instruction`, rerun the installer and let it fall back to the Bun baseline binary for older CPUs

### One-Line Install (Recommended)

The fastest way to get started:

```bash
curl -fsSL https://raw.githubusercontent.com/zhaofinger/cc-im/main/install.sh | bash
```

This will automatically:

- Install bun (if not present)
- Fall back to the Bun baseline binary on older x64 CPUs that cannot run the default Bun build
- Clone the repository to `~/.cc-im`
- Update the existing installation when `~/.cc-im` is already present
- Guide you through configuration
- Sync `ANTHROPIC_*` variables from your current shell or common shell config files into `~/.cc-im/.env`
- Install dependencies
- **Install as a background service** (systemd on Linux, launchd on macOS)
- Build the service `PATH` from your current shell environment and common user bin directories
- Create a `cc-im` command for service management
- Restart the service automatically after an update

If your shell cannot provide an interactive TTY, the installer now skips the initial "Press Enter" confirmation automatically. For fully non-interactive installs, pre-set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ALLOWED_CHAT_ID` before running the command.

On Linux/macOS x64, you can force the more compatible Bun build explicitly with `CC_IM_BUN_VARIANT=baseline` during install.

After installation, use these commands:

```bash
cc-im start    # Start the service
cc-im stop     # Stop the service
cc-im restart  # Restart the service
cc-im status   # Check service status
cc-im logs     # View logs
```

### Manual Installation

If you prefer to install manually:

```bash
# Clone the repository
git clone https://github.com/zhaofinger/cc-im.git ~/.cc-im
cd ~/.cc-im

# Install bun (if not installed)
# See: https://bun.sh

# Install dependencies
bun install

# Copy and configure environment variables
cp .env.example .env
# Edit .env with your configuration

# Install as background service
bash deploy/install-service.sh --user

# On Linux user services, cc-im omits User=/Group= automatically so systemd --user can start cleanly

# Or start manually
bun run start
```

### Service Management

For manually installed services, use:

```bash
# Control the service
cc-im start      # Start service (after install)
cc-im stop       # Stop service
cc-im restart    # Restart service
cc-im status     # Check status
cc-im logs       # View logs

# Or use system commands directly
systemctl --user start cc-im    # Linux
launchctl start com.cc-im.app   # macOS
```

---

## ⚙️ Configuration

Copy `.env.example` to `.env` and configure:

| Variable                            | Required | Description                                                                                                              |
| ----------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| `TELEGRAM_BOT_TOKEN`                | ✅       | Your Telegram bot token from @BotFather                                                                                  |
| `TELEGRAM_ALLOWED_CHAT_ID`          | ✅       | Restrict bot to your chat only (get from @userinfobot)                                                                   |
| `WORKSPACE_ROOT`                    | ❌       | Root directory containing workspaces (default: `/code_workspace`)                                                        |
| `LOG_DIR`                           | ❌       | Log directory (default: `./cc_im_logs`)                                                                                  |
| `AGENT_PROVIDER`                    | ❌       | CLI tool to use: `claude` or `codex` (default: `claude`)                                                                 |
| `CLAUDE_COMMANDS_PAGE_SIZE`         | ❌       | Commands per page in /cc menu (default: `8`)                                                                             |
| `CLAUDE_APPROVAL_TIMEOUT_MS`        | ❌       | Timeout for Telegram approval requests (default: `300000`)                                                               |
| `CLAUDE_INPUT_EDIT_TIMEOUT_MS`      | ❌       | Timeout for edited approval input flow (default: `300000`)                                                               |
| `TELEGRAM_PROGRESS_DEBOUNCE_MS`     | ❌       | Debounce window for progress card edits in milliseconds (default: `2000`)                                                |
| `TELEGRAM_PROGRESS_MIN_INTERVAL_MS` | ❌       | Minimum interval between progress card edits in milliseconds (default: `10000`)                                          |
| `CLAUDE_DEFAULT_PERMISSION_MODE`    | ❌       | Claude permission mode: `default`, `acceptEdits`, `auto`, `dontAsk`, `plan`, or `bypassPermissions` (default: `default`) |

---

## 📱 Commands

| Command      | Description                   |
| ------------ | ----------------------------- |
| `/start`     | Show help                     |
| `/workspace` | Choose a workspace            |
| `/mode`      | Choose Claude permission mode |
| `/status`    | Show current status           |
| `/stop`      | Stop the active run           |
| `/cc`        | Show Claude slash commands    |

Any other text or commands are forwarded directly to Claude Code in the selected workspace.

---

## 📊 Status Display

The bot displays real-time status using HTML formatting:

```
<b>· Claude Code</b>
<code>my-project main ✓</code>
<i>default</i>

<b>Tool</b>
<blockquote expandable>⠋ Read File 正在执行</blockquote>
```

Status includes:

- Spinner indicator while running, checkmark when completed
- Current workspace, git branch, and dirty status
- Permission mode indicator
- Tool call history with expandable details

When Claude requests permission for a tool call, the bot can:

- Approve once
- Reject
- Edit the tool input by replying with a JSON object from Telegram

Supported Claude permission modes:

- `default`
- `acceptEdits`
- `auto`
- `dontAsk`
- `plan`
- `bypassPermissions`

---

## 🔒 Security

- **Single Chat Restriction**: Use `TELEGRAM_ALLOWED_CHAT_ID` to restrict bot access
- **Workspace Isolation**: Each workspace has its own Claude session
- **Interactive Approval Flow**: In modes where Claude emits approval requests, tool approvals are routed to Telegram and require an explicit response
- **Automatic Modes**: `auto` and `dontAsk` are passed through directly to Claude CLI and follow Claude's own permission behavior
- **Bypass Mode**: `bypassPermissions` skips approval checks and should only be used in trusted environments

---

## 🛠️ Development

```bash
# Run in development mode
bun run dev

# Run tests
bun test

# Type check and lint
bun run check
```

---

## 📝 Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Telegram  │────▶│   Bridge    │────▶│    Agent    │
│    Bot      │◀────│   Server    │◀────│   (Claude)  │
└─────────────┘     └─────────────┘     └─────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │   Memory    │
                    │    State    │
                    └─────────────┘
```

---

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

---

## 🙏 Acknowledgments

- [Claude Code](https://github.com/anthropics/claude-code) - The official Claude Code CLI
- [Grammy](https://grammy.dev/) - The Telegram Bot Framework
- [Bun](https://bun.sh/) - The fast all-in-one JavaScript runtime

---

<p align="center">
  Made with ❤️ by <a href="https://github.com/zhaofinger">zhaofinger</a>
</p>
