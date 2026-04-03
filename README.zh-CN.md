# cc-im

Claude Code 的 Telegram 桥接器，使用 Bun + TypeScript 构建。通过 Telegram 直接控制 Claude Code！

<p align="center">
  <img src="https://img.shields.io/badge/Bun-%23000000.svg?style=for-the-badge&logo=bun&logoColor=white" alt="Bun">
  <img src="https://img.shields.io/badge/TypeScript-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Telegram-2CA5E0?style=for-the-badge&logo=telegram&logoColor=white" alt="Telegram">
</p>

<p align="center">
  <a href="README.md">English</a> | <strong>中文</strong>
</p>

---

## ✨ 功能特性

- 🤖 **无缝 Claude Code 集成** - 通过 Telegram 远程控制 Claude Code
- 📁 **工作区管理** - 在多个工作区之间选择和切换
- 🔧 **实时工具跟踪** - 实时可视化工具调用及其结果
- 🛡️ **安全审批流程** - 在手机上批准或拒绝敏感操作
- 💬 **交互式命令** - 分页式斜杠命令菜单 (/cc)
- 📝 **会话持久化** - 为每个工作区保持 Claude 会话
- 🎨 **精美状态显示** - 带表情符号指示器的盒式状态消息

---

## 🚀 快速开始

### 前置要求

- 安装 [Bun](https://bun.sh/)
- Telegram Bot Token（从 [@BotFather](https://t.me/botfather) 获取）
- 已安装并认证 Claude Code

### 安装

```bash
# 克隆仓库
git clone https://github.com/zhaofinger/cc-im.git
cd cc-im

# 安装依赖
bun install

# 复制并配置环境变量
cp .env.example .env
# 编辑 .env 文件进行配置

# 启动机器人
bun run start
```

---

## ⚙️ 配置

复制 `.env.example` 到 `.env` 并配置：

| 变量名 | 必填 | 说明 |
|--------|------|------|
| `TELEGRAM_BOT_TOKEN` | ✅ | 从 @BotFather 获取的 Telegram 机器人令牌 |
| `TELEGRAM_ALLOWED_CHAT_ID` | ❌ | 限制特定聊天可使用（推荐） |
| `WORKSPACE_ROOT` | ❌ | 包含工作区的根目录（默认：`/code_workspace`） |
| `LOG_DIR` | ❌ | 日志目录（默认：`./logs`） |
| `CLAUDE_MODEL` | ❌ | 覆盖默认 Claude 模型 |
| `CLAUDE_PERMISSION_MODE` | ❌ | 权限模式（默认：`default`） |
| `CLAUDE_COMMANDS_PAGE_SIZE` | ❌ | /cc 菜单每页命令数（默认：`8`） |

### 可选的 Anthropic 配置

| 变量名 | 说明 |
|--------|------|
| `ANTHROPIC_API_KEY` | 直接 API 密钥认证 |
| `ANTHROPIC_BASE_URL` | 自定义 API 端点（第三方提供商） |
| `ANTHROPIC_AUTH_TOKEN` | 自定义端点的认证令牌 |
| `CLAUDE_CODE_OAUTH_TOKEN` | Claude Code OAuth 令牌 |

---

## 📱 命令

| 命令 | 说明 |
|------|------|
| `/start` | 显示帮助信息 |
| `/workspace` | 从配置的根目录选择工作区 |
| `/status` | 显示当前状态和运行中任务 |
| `/stop` | 停止当前 Claude 运行 |
| `/cc` | 打开 Claude 斜杠命令菜单 |

任何其他文本或命令都会直接转发到所选工作区的 Claude Code。

---

## 📊 状态显示

机器人显示精美的盒式状态消息，展示：

```
╔══════════════════════════════════════╗
║  🤖 Claude Code 🔧 Using tool        ║
╠══════════════════════════════════════╣
║  ⏱️  45s                             ║
║  📁 my-project                       ║
║  📝 a1b2c3d8                         ║
╠══════════════════════════════════════╣
║  🔧 当前工具: Read File              ║
║     运行时长: 5s                     ║
╠══════════════════════════════════════╣
║  🛠️  工具调用 (3):                   ║
║    ✅ Read File (2s)                 ║
║       → 文件内容预览...              ║
║    ✅ Bash Command (1s)              ║
╚══════════════════════════════════════╝
```

---

## 🔒 安全

- **单聊限制**: 使用 `TELEGRAM_ALLOWED_CHAT_ID` 限制机器人访问
- **审批流程**: 敏感操作需要显式批准
- **工作区隔离**: 每个工作区有自己的 Claude 会话
- **无持久状态**: 纯内存存储（为安全起见，重启后重置）

---

## 🛠️ 开发

```bash
# 开发模式运行
bun run dev

# 运行测试
bun test

# 构建
bun build
```

---

## 📝 架构

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Telegram  │────▶│    桥接     │────▶│    代理     │
│    机器人   │◀────│    服务     │◀────│   (Claude)  │
└─────────────┘     └─────────────┘     └─────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │    内存     │
                    │    状态     │
                    └─────────────┘
```

---

## 📄 许可证

MIT 许可证 - 详见 [LICENSE](LICENSE)。

---

## 🙏 致谢

- [Claude Code](https://github.com/anthropics/claude-code) - 官方 Claude Code CLI
- [Grammy](https://grammy.dev/) - Telegram Bot 框架
- [Bun](https://bun.sh/) - 快速全功能 JavaScript 运行时

---

<p align="center">
  用 ❤️ 制作 by <a href="https://github.com/zhaofinger">zhaofinger</a>
</p>
