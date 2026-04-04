# Repository Guidelines

## 项目结构与模块组织

`src/` 是主代码目录，入口为 `src/main.ts`。按职责拆分为：`src/agent/` 处理 Claude/Codex 集成，`src/telegram/` 处理机器人 API 与菜单，`src/bridge/` 负责消息桥接，`src/state/` 管理运行态，`src/utils/` 放通用工具。测试统一放在 `src/__tests__/`。运行日志写入 `logs/`。`test_workspace/` 仅用于本地测试，不放正式代码。

## 构建、测试与开发命令

先执行 `bun install`。

- `bun run dev`：以监听模式启动 `src/main.ts`，用于本地开发。
- `bun run start`：直接运行程序，不开启监听。
- `bun run typecheck`：执行 `tsc --noEmit` 做严格类型检查。
- `bun run lint`：使用 `oxlint` 检查 `src/` 下代码。
- `bun run lint:fix`：自动修复可安全处理的 lint 问题。
- `bun run fmt`：使用 `oxfmt` 格式化仓库代码。
- `bun run fmt:check`：检查格式是否符合要求。
- `bun run check`：串行执行类型检查、lint 和格式检查。
- `bun test`：运行 Bun 测试。

日常改动至少执行 `bun run check`。如果改动了 `src/agent/`、`src/bridge/`、`src/config.ts` 或 `src/utils/`，还应补跑 `bun test`。

## 代码风格与命名约定

项目使用 TypeScript、ES Modules 和严格模式。保持现有风格：双引号、分号、模块职责单一。变量与函数用 `camelCase`，类型与接口用 `PascalCase`。文件名延续当前模式，例如 `startup-check.ts`、`memory-state.ts`。优先做小而明确的改动，不要顺手重命名无关文件或调整目录结构。

## 测试规范

测试框架为 `bun:test`。新增测试放在 `src/__tests__/`，文件名使用 `*.test.ts`。实现新功能前，先写或先补对应测试用例，再开始改动实现。修改配置解析、环境变量读取、消息格式化、workspace 解析或 bridge 状态流转时，应同步补充或更新测试。测试必须可重复、无副作用；涉及环境变量时，参考 `src/__tests__/config.test.ts`，在 `beforeEach` 和 `afterEach` 中隔离修改。

## 提交与 Pull Request 规范

近期提交主要采用简短祈使句或 Conventional Commits 风格，例如 `feat: ...`、`refactor: ...`。保持一致即可。PR 需要写清楚变更摘要、行为或配置变化、关联 issue；如果改了 Telegram 展示效果，附上截图或聊天记录。发起评审前，确保 `.githooks/pre-commit` 会通过，它会执行 `typecheck`、`lint` 和 `fmt:check`。

## 安全与配置说明

不要提交 `.env`、真实机器人令牌或本地日志。请从 `.env.example` 开始配置，并在新增环境变量时同步更新 `README.md`。如果修改了鉴权、聊天白名单、审批流程或默认工作目录，需要在 PR 中明确说明安全影响和回滚方式。

## Agent 操作约束

修改前先确认影响模块，只改与任务直接相关的文件。不要把格式化、重构和业务修复混在同一个提交里。除非任务明确要求，否则不要改 `.githooks/`、`README.md` 中无关章节、`test_workspace/` 内容或环境变量默认值。若发现仓库已有脏改动，避免覆盖它们。
