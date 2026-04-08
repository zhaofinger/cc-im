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

安装前需要准备：

- **Telegram Bot Token** - 从 [@BotFather](https://t.me/botfather) 获取
- **Claude Code** - 已安装并认证（[安装指南](https://github.com/anthropics/claude-code)）
- **x64 主机上的 Bun 兼容 CPU** - 如果你的 Linux/macOS x64 服务器出现 `Illegal instruction`，重新运行安装脚本后会自动回退到适用于旧 CPU 的 Bun baseline 二进制

### 一行命令安装（推荐）

最快的开始方式：

```bash
curl -fsSL https://raw.githubusercontent.com/zhaofinger/cc-im/main/install.sh | bash
```

这将自动：

- 安装 bun（如未安装）
- 在较老的 x64 CPU 上自动回退到更兼容的 Bun baseline 二进制
- 克隆仓库到 `~/.cc-im`
- 引导配置
- 安装依赖
- **安装为后台服务**（Linux 用 systemd，macOS 用 launchd）
- 创建 `cc-im` 命令管理服务

如果你的 shell 无法提供交互式 TTY，安装器会自动跳过开头的“按回车继续”确认。完全无人值守安装时，可以先设置 `TELEGRAM_BOT_TOKEN` 和 `TELEGRAM_ALLOWED_CHAT_ID`。

在 Linux/macOS x64 上，也可以在安装时显式设置 `CC_IM_BUN_VARIANT=baseline`，强制使用兼容性更高的 Bun 版本。

安装完成后，使用以下命令：

```bash
cc-im start    # 启动服务
cc-im stop     # 停止服务
cc-im restart  # 重启服务
cc-im status   # 查看状态
cc-im logs     # 查看日志
```

### 手动安装

如果你偏好手动安装：

```bash
# 克隆仓库
git clone https://github.com/zhaofinger/cc-im.git ~/.cc-im
cd ~/.cc-im

# 安装 bun（如未安装）
# 参见：https://bun.sh

# 安装依赖
bun install

# 复制并配置环境变量
cp .env.example .env
# 编辑 .env 文件进行配置

# 安装为后台服务
bash deploy/install-service.sh --user

# 或直接前台启动
bun run start
```

### 服务管理

手动安装后，使用以下命令管理服务：

```bash
# 管理服务
cc-im start      # 启动服务（安装后可用）
cc-im stop       # 停止服务
cc-im restart    # 重启服务
cc-im status     # 查看状态
cc-im logs       # 查看日志

# 或直接执行系统命令
systemctl --user start cc-im    # Linux
launchctl start com.cc-im.app   # macOS
```

---

## ⚙️ 配置

复制 `.env.example` 到 `.env` 并配置：

| 变量名                      | 必填 | 说明                                                 |
| --------------------------- | ---- | ---------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`        | ✅   | 从 @BotFather 获取的 Telegram 机器人令牌             |
| `TELEGRAM_ALLOWED_CHAT_ID`  | ✅   | 从 @userinfobot 获取的 Chat ID，限制仅你的聊天可使用 |
| `WORKSPACE_ROOT`            | ❌   | 包含工作区的根目录（默认：`/code_workspace`）        |
| `LOG_DIR`                   | ❌   | 日志目录（默认：`./cc_im_logs`）                     |
| `AGENT_PROVIDER`            | ❌   | 使用 CLI 工具：`claude` 或 `codex`（默认：`claude`） |
| `CLAUDE_COMMANDS_PAGE_SIZE` | ❌   | /cc 菜单每页命令数（默认：`8`）                      |

---

---

## 📱 命令

| 命令         | 说明                     |
| ------------ | ------------------------ |
| `/start`     | 显示帮助信息             |
| `/workspace` | 从配置的根目录选择工作区 |
| `/status`    | 显示当前状态和运行中任务 |
| `/stop`      | 停止当前 Claude 运行     |
| `/cc`        | 打开 Claude 斜杠命令菜单 |

任何其他文本或命令都会直接转发到所选工作区的 Claude Code。

---

## 📊 状态显示

机器人使用 HTML 格式显示实时状态：

```
<b>· Claude Code</b>
<code>my-project main ✓</code>
<code>›› permissions default</code>

<b>Tool</b>
<blockquote expandable>⠋ Read File 正在执行</blockquote>
```

状态包括：

- 运行时显示旋转指示器，完成后显示对勾
- 当前工作区、Git 分支和文件修改状态
- 权限模式指示器
- 可展开的工具调用历史

---

## 🔒 安全

- **单聊限制**: 使用 `TELEGRAM_ALLOWED_CHAT_ID` 限制机器人访问
- **工作区隔离**: 每个工作区有自己的 Claude 会话
- **危险模式**: 此机器人使用 `--dangerously-skip-permissions`，意味着 Claude Code 将执行所有操作而不请求审批。请谨慎使用。

---

## 🛠️ 开发

```bash
# 开发模式运行
bun run dev

# 运行测试
bun test

# 类型检查和代码检查
bun run check
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
