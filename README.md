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
- 💬 **Interactive Commands** - Paginated slash command menu (/cc)
- 📝 **Session Persistence** - Maintains Claude sessions per workspace
- 🎨 **Beautiful Status Display** - Box-style status messages with emoji indicators

---

## 🚀 Quick Start

### Prerequisites

- [Bun](https://bun.sh/) installed
- Telegram Bot Token (get from [@BotFather](https://t.me/botfather))
- Claude Code installed and authenticated

### Installation

```bash
# Clone the repository
git clone https://github.com/zhaofinger/cc-im.git
cd cc-im

# Install dependencies
bun install

# Copy and configure environment variables
cp .env.example .env
# Edit .env with your configuration

# Start the bot
bun run start
```

---

## ⚙️ Configuration

Copy `.env.example` to `.env` and configure:

| Variable                    | Required | Description                                                       |
| --------------------------- | -------- | ----------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`        | ✅       | Your Telegram bot token from @BotFather                           |
| `TELEGRAM_ALLOWED_CHAT_ID`  | ❌       | Restrict bot to specific chat (recommended)                       |
| `WORKSPACE_ROOT`            | ❌       | Root directory containing workspaces (default: `/code_workspace`) |
| `LOG_DIR`                   | ❌       | Log directory (default: `./logs`)                                 |
| `CLAUDE_MODEL`              | ❌       | Override default Claude model                                     |
| `CLAUDE_PERMISSION_MODE`    | ❌       | Permission mode (default: `default`)                              |
| `CLAUDE_COMMANDS_PAGE_SIZE` | ❌       | Commands per page in /cc menu (default: `8`)                      |

### Optional Anthropic Configuration

| Variable                  | Description                                     |
| ------------------------- | ----------------------------------------------- |
| `ANTHROPIC_API_KEY`       | Direct API key authentication                   |
| `ANTHROPIC_BASE_URL`      | Custom API endpoint (for third-party providers) |
| `ANTHROPIC_AUTH_TOKEN`    | Auth token for custom endpoints                 |
| `CLAUDE_CODE_OAUTH_TOKEN` | Claude Code OAuth token                         |

---

## 📱 Commands

| Command      | Description                                 |
| ------------ | ------------------------------------------- |
| `/start`     | Show help message                           |
| `/workspace` | Select a workspace from the configured root |
| `/status`    | Display current status and active run       |
| `/stop`      | Stop the current Claude run                 |
| `/cc`        | Open the Claude slash command menu          |

Any other text or commands are forwarded directly to Claude Code in the selected workspace.

---

## 📊 Status Display

The bot displays beautiful box-style status messages showing:

```
╔══════════════════════════════════════╗
║  🤖 Claude Code 🔧 Using tool        ║
╠══════════════════════════════════════╣
║  ⏱️  45s                             ║
║  📁 my-project                       ║
║  📝 a1b2c3d8                         ║
╠══════════════════════════════════════╣
║  🔧 Current Tool: Read File          ║
║     Running for: 5s                  ║
╠══════════════════════════════════════╣
║  🛠️  Tool Calls (3):                 ║
║    ✅ Read File (2s)                 ║
║       → file content preview...      ║
║    ✅ Bash Command (1s)              ║
╚══════════════════════════════════════╝
```

---

## 🔒 Security

- **Single Chat Restriction**: Use `TELEGRAM_ALLOWED_CHAT_ID` to restrict bot access
- **Approval Flow**: Sensitive operations require explicit approval
- **Workspace Isolation**: Each workspace has its own Claude session
- **No Persistent State**: In-memory only (resets on restart for security)

---

## 🛠️ Development

```bash
# Run in development mode
bun run dev

# Run tests
bun test

# Build
bun build
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
