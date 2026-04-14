# cc-im

A Telegram bridge for Claude Code and Codex CLI, built with Bun + TypeScript. It runs the local agent CLI directly from Telegram, without an extra backend service.

<p align="center">
  <a href="README.md"><strong>English</strong></a> | <a href="README.zh-CN.md">中文</a>
</p>

## What It Does

- Sends Telegram messages to local `claude` or `codex` CLI runs
- Switches workspaces before each run
- Streams run status and tool activity back to Telegram
- Supports approval flows and permission mode switching
- Persists workspace state, including Claude transcript sessions
- Accepts Telegram photos and image documents as local file inputs

## Quick Start

Prerequisites:

- A Telegram bot token from [@BotFather](https://t.me/botfather)
- Claude Code or Codex CLI installed and authenticated
- Bun available on the host, or let the installer set it up

Recommended install:

```bash
curl -fsSL https://raw.githubusercontent.com/zhaofinger/cc-im/main/install.sh | bash
```

The installer can:

- install Bun when needed
- clone or update `~/.cc-im`
- guide `.env` setup
- install dependencies
- register a background service on Linux or macOS
- create the `cc-im` helper command

Common service commands:

```bash
cc-im start
cc-im stop
cc-im restart
cc-im update
cc-im status
cc-im logs
```

Manual install:

```bash
git clone https://github.com/zhaofinger/cc-im.git ~/.cc-im
cd ~/.cc-im
bun install
cp .env.example .env
bun run start
```

To install the user service manually:

```bash
bash deploy/install-service.sh --user
```

## Configuration

Copy `.env.example` to `.env`.

Required:

| Variable                   | Required | Description                  |
| -------------------------- | -------- | ---------------------------- |
| `TELEGRAM_BOT_TOKEN`       | Yes      | Telegram bot token           |
| `TELEGRAM_ALLOWED_CHAT_ID` | Yes      | Restrict the bot to one chat |

Common optional:

- `WORKSPACE_ROOT`: root directory containing selectable workspaces
- `AGENT_PROVIDER`: `claude` or `codex`

## Telegram Commands

| Command      | Description                                            |
| ------------ | ------------------------------------------------------ |
| `/start`     | Show help                                              |
| `/workspace` | Select a workspace                                     |
| `/new`       | Start a new session                                    |
| `/resume`    | Resume a previous Claude transcript session            |
| `/mode`      | Switch permission mode                                 |
| `/status`    | Show current state                                     |
| `/stop`      | Stop the active run                                    |
| `/cc`        | Show available slash commands from the active provider |

Any other text is forwarded to the configured agent in the selected workspace.

Notes:

- `/resume` only works for Claude transcript sessions
- When `AGENT_PROVIDER=codex`, `/cc` may be empty if no commands are exposed
- Telegram photos and image documents are saved under `~/.cc-im/logs/telegram-media/...` and passed to the agent as local file paths

## Development

```bash
bun install
bun run check
bun test
```

Useful commands:

- `bun run dev`
- `bun run start`
- `bun run typecheck`
- `bun run lint`
- `bun run fmt`

## License

MIT. See [LICENSE](LICENSE).
