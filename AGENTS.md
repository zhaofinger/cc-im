# Repository Guidelines

## 结构

- 主代码在 `src/`，入口是 `src/main.ts`
- 模块分工：`src/agent/` 集成 Claude/Codex，`src/telegram/` 处理 Bot API/菜单，`src/bridge/` 处理消息桥接，`src/state/` 管理运行态，`src/utils/` 放通用工具
- 测试放在 `src/__tests__/`
- 日志写入 `logs/`
- `test_workspace/` 仅用于本地测试

## 开发与检查

- 先执行 `bun install`
- 常用命令：`bun run dev`、`bun run start`、`bun run typecheck`、`bun run lint`、`bun run lint:fix`、`bun run fmt`、`bun run fmt:check`、`bun run check`、`bun test`
- 日常改动至少跑 `bun run check`
- 如果改动了 `src/agent/`、`src/bridge/`、`src/config.ts` 或 `src/utils/`，还要补跑 `bun test`

## 代码与测试

- 使用 TypeScript、ES Modules、严格模式；保持双引号和分号
- 变量/函数用 `camelCase`，类型/接口用 `PascalCase`
- 文件名沿用现有风格，如 `startup-check.ts`、`memory-state.ts`
- 优先做小而直接的改动，不顺手重命名无关文件或调整目录
- 测试框架是 `bun:test`，新增测试放在 `src/__tests__/`，命名为 `*.test.ts`
- 涉及配置解析、环境变量、消息格式化、workspace 解析或 bridge 状态流转时，要同步补测试
- 测试要可重复、无副作用；环境变量相关测试参考 `src/__tests__/config.test.ts`，在 `beforeEach` / `afterEach` 中隔离修改

## 提交与文档

- 提交风格保持简短祈使句或 Conventional Commits，例如 `feat: ...`
- PR 说明使用中文，写清变更摘要、行为或配置变化、关联 issue
- 任何影响用户可见行为、配置、部署或命令用法的改动，必须同步更新 `README.md`
- 新增环境变量时，同时更新 `.env.example` 和 `README.md`

## 约束

- 不提交 `.env`、真实令牌或本地日志
- 修改前先确认影响范围，只改和任务直接相关的文件
- 不要把格式化、重构和业务修复混在同一个提交里
- 除非任务明确要求，不改 `.githooks/`、`README.md` 无关章节、`test_workspace/` 或环境变量默认值
- 如果仓库已有脏改动，不要覆盖它们
