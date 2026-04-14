# cc-im

一个基于 Bun + TypeScript 的 Telegram 桥接器，用来从 Telegram 直接调用本地的 Claude Code 或 Codex CLI，不需要额外后端服务。

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh-CN.md"><strong>中文</strong></a>
</p>

## 功能概览

- 把 Telegram 消息转发给本地 `claude` 或 `codex` CLI
- 每次运行前切换到目标工作区
- 将运行状态和工具调用实时回传到 Telegram
- 支持审批流程和权限模式切换
- 持久化工作区状态，包括 Claude transcript 会话
- 支持 Telegram 图片和图片文档作为本地文件输入

## 快速开始

前置要求：

- 从 [@BotFather](https://t.me/botfather) 获取 Telegram Bot Token
- 已安装并认证 Claude Code 或 Codex CLI
- 主机可用 Bun，或者直接使用安装脚本自动安装

推荐安装方式：

```bash
curl -fsSL https://raw.githubusercontent.com/zhaofinger/cc-im/main/install.sh | bash
```

安装脚本会自动处理：

- 按需安装 Bun
- 克隆或更新 `~/.cc-im`
- 引导完成 `.env` 配置
- 安装依赖
- 在 Linux 或 macOS 上注册后台服务
- 创建 `cc-im` 管理命令

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

## 配置

复制 `.env.example` 为 `.env`。

必填：

| 变量                       | 必填 | 说明                 |
| -------------------------- | ---- | -------------------- |
| `TELEGRAM_BOT_TOKEN`       | 是   | Telegram Bot Token   |
| `TELEGRAM_ALLOWED_CHAT_ID` | 是   | 限制仅指定聊天可访问 |

常用可选：

- `WORKSPACE_ROOT`：可选工作区所在根目录
- `AGENT_PROVIDER`：`claude` 或 `codex`

## Telegram 命令

| 命令         | 说明                              |
| ------------ | --------------------------------- |
| `/start`     | 显示帮助                          |
| `/workspace` | 选择工作区                        |
| `/new`       | 开启新会话                        |
| `/resume`    | 恢复之前的 Claude transcript 会话 |
| `/mode`      | 切换权限模式                      |
| `/status`    | 查看当前状态                      |
| `/stop`      | 停止当前运行                      |
| `/cc`        | 查看当前 provider 暴露的斜杠命令  |

其他文本会直接转发给当前工作区中的已配置 agent。

补充说明：

- `/resume` 仅对 Claude transcript 会话生效
- 当 `AGENT_PROVIDER=codex` 时，如果 provider 没有暴露命令，`/cc` 可能为空
- Telegram 图片和图片文档会保存到 `~/.cc-im/logs/telegram-media/...`，再以本地文件路径形式传给 agent

## 开发

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

## 许可证

MIT，详见 [LICENSE](LICENSE)。
