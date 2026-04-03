# cc-im

Telegram bridge for Claude Code, built with Bun + TypeScript.

## What it does

- Uses Telegram Bot API with long polling
- Supports a single trusted chat
- Lets you choose a workspace from a configurable root directory
- Maintains one Claude session per workspace in memory
- Forwards plain text and slash commands to Claude Code
- Exposes a `/cc` paginated menu for Claude slash commands

## Current scope

- Only Claude Code is wired
- Codex adapter is a placeholder
- State is in-memory only
- Logs are written to files
- Claude permission prompts are handled through the official Agent SDK callback

## Configuration

Copy `.env.example` to `.env` and fill in:

- `TELEGRAM_BOT_TOKEN`: required
- `TELEGRAM_ALLOWED_CHAT_ID`: optional; if set, only this chat can use the bot
- `WORKSPACE_ROOT`: root folder whose first-level directories are selectable workspaces
- `LOG_DIR`: log directory
- `ANTHROPIC_BASE_URL`: optional third-party Claude-compatible base URL
- `ANTHROPIC_AUTH_TOKEN`: optional auth token used with `ANTHROPIC_BASE_URL`
- `ANTHROPIC_API_KEY`: optional Anthropic API key
- `CLAUDE_CODE_OAUTH_TOKEN`: optional Claude Code OAuth token
- `CLAUDE_MODEL`: optional model override
- `CLAUDE_PERMISSION_MODE`: defaults to `default`
- `CLAUDE_COMMANDS_PAGE_SIZE`: commands shown per `/cc` page

## Commands

- `/start`: show help
- `/workspace`: pick a workspace from the configured root
- `/status`: show active workspace and run state
- `/stop`: stop the active Claude run
- `/cc`: open the Claude slash command menu

All other text, including unknown slash commands, is forwarded to Claude Code in the current workspace.

## Run

```bash
bun install
bun run start
```

On startup, the service performs self-checks for:

- Telegram bot token validity
- `WORKSPACE_ROOT` existence and directory shape
- Claude auth-related configuration presence

## Notes

- Service restarts clear in-memory workspace bindings and active runs.
- The bot assumes Claude Code is already installed and authenticated on the host.

## TODO

1. 会话文件夹权限问题
2. 状态信息显示 tool 调用等
3. 代码精简优化
