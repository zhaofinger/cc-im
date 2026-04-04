# Repository Guidelines

## 项目结构与模块组织
`src/` 是主代码目录，入口文件为 `src/main.ts`。按职责划分为：`src/agent/` 负责 Claude/Codex 集成，`src/telegram/` 负责机器人 API 与菜单，`src/bridge/` 负责消息桥接流程，`src/state/` 管理运行时状态，`src/utils/` 存放通用工具。测试放在 `src/__tests__/`，当前覆盖配置加载、日志、启动检查和 Claude 环境处理。运行日志默认写入 `logs/`。`test_workspace/` 仅用于本地测试场景，不应放业务代码。

## 构建、测试与开发命令
先执行 `bun install` 安装依赖。

- `bun run dev`：以监听模式启动 `src/main.ts`，用于本地开发。
- `bun run start`：直接运行程序，不开启监听。
- `bun run typecheck`：执行 `tsc --noEmit` 做严格类型检查。
- `bun run lint`：使用 `oxlint` 检查 `src/` 下代码。
- `bun run lint:fix`：自动修复可安全处理的 lint 问题。
- `bun run fmt`：使用 `oxfmt` 格式化仓库代码。
- `bun run fmt:check`：检查格式是否符合要求。
- `bun run check`：串行执行类型检查、lint 和格式检查。
- `bun test`：运行 Bun 测试。

## 代码风格与命名约定
项目使用 TypeScript、ES Modules 和严格模式。保持现有风格：双引号、分号、模块职责单一。变量与函数使用 `camelCase`，类型与接口使用 `PascalCase`。文件名延续当前模式，例如 `startup-check.ts`、`memory-state.ts`。提交前至少运行 `bun run fmt` 和 `bun run lint`。

## 测试规范
测试框架为 `bun:test`。新增测试请放在 `src/__tests__/`，文件名使用 `*.test.ts`。优先补充配置解析、Telegram 文本格式化、workspace 解析、bridge 状态流转等单元测试。测试应保持可重复、无副作用；涉及环境变量时，参考 `src/__tests__/config.test.ts` 的做法，在 `beforeEach` 和 `afterEach` 中隔离修改。

## 提交与 Pull Request 规范
近期提交主要采用简短祈使句或 Conventional Commits 风格，例如 `feat: ...`、`refactor: ...`。后续提交建议保持一致。PR 需包含变更摘要、行为或配置变更说明、关联 issue；若修改了 Telegram 展示效果，附上截图或聊天记录。发起评审前，确保 `.githooks/pre-commit` 对应检查可在本地通过。

## 安全与配置说明
不要提交 `.env` 或真实的机器人令牌。请从 `.env.example` 开始配置，并在新增环境变量时同步更新 `README.md`。如果修改了鉴权、聊天白名单或审批流程，需要在 PR 中明确说明安全影响。
