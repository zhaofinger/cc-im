# cc-im

[English README](README.en.md)

在 Telegram 里直接调用本地 Claude Code 或 Codex CLI。

## ✨ 为什么用它

- 直接调用原生 CLI，不额外包一层服务
- 每次执行前都可以切换到目标工作目录
- 工具调用和运行状态会实时发回 Telegram

## 🖼️ 界面预览

### 工作区选择

![工作区选择界面](docs/images/workspace-picker.png)

### 会话恢复

![会话恢复界面](docs/images/resume-session.png)

### 工具调用回传

![工具调用回传界面](docs/images/tool-stream.png)

## 🚀 快速开始

前置要求：

- 从 [@BotFather](https://t.me/botfather) 获取 Telegram Bot Token
- 已安装并完成认证的 Claude Code 或 Codex CLI
- 运行机器上可用 Bun，或者直接使用安装脚本自动安装

推荐安装：

```bash
curl -fsSL https://raw.githubusercontent.com/zhaofinger/cc-im/main/install.sh | bash
```

安装脚本会自动完成这些步骤：

- 按需安装 Bun
- 克隆或更新 `~/.cc-im`
- 引导你完成 `.env` 配置
- 安装依赖
- 在 Linux 或 macOS 上注册后台服务
- 创建 `cc-im` 命令

常用服务命令：

```bash
cc-im start
cc-im stop
cc-im restart
cc-im update
cc-im status
cc-im logs
```

手动安装：

```bash
git clone https://github.com/zhaofinger/cc-im.git ~/.cc-im
cd ~/.cc-im
bun install
cp .env.example .env
bun run start
```

如需手动安装用户级服务：

```bash
bash deploy/install-service.sh --user
```

## 🤖 Telegram 命令

| 命令         | 说明                          |
| ------------ | ----------------------------- |
| `/start`     | 显示帮助                      |
| `/workspace` | 选择工作区                    |
| `/new`       | 开启新会话                    |
| `/resume`    | 恢复之前的 Claude 会话记录    |
| `/mode`      | 切换权限模式                  |
| `/status`    | 查看当前状态                  |
| `/stop`      | 停止当前运行                  |
| `/cc`        | 查看当前 agent 提供的斜杠命令 |

其他文本会直接转发给当前工作区中已配置的 agent。

补充说明：

- `/resume` 仅对 Claude 的会话记录生效
- 当 `AGENT_PROVIDER=codex` 时，如果当前 agent 没有提供斜杠命令，`/cc` 可能为空
- Telegram 图片和图片文档会保存到 `~/.cc-im/logs/telegram-media/...`，再以本地文件路径传给 agent

## ⚙️ 配置

将 `.env.example` 复制为 `.env`。

必填项：

| 变量                       | 必填 | 说明                  |
| -------------------------- | ---- | --------------------- |
| `TELEGRAM_BOT_TOKEN`       | 是   | Telegram 机器人 Token |
| `TELEGRAM_ALLOWED_CHAT_ID` | 是   | 仅允许指定聊天访问    |

常用可选项：

- `WORKSPACE_ROOT`：可选工作区的根目录
- `AGENT_PROVIDER`：`claude` 或 `codex`

## 🛠️ 开发

```bash
bun install
bun run check
bun test
```

常用命令：

- `bun run dev`
- `bun run start`
- `bun run typecheck`
- `bun run lint`
- `bun run fmt`

## 📄 许可证

MIT，详见 [LICENSE](LICENSE)。
