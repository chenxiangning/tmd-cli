# AGENTS.md —— tmd-cli 全体 AI 协作铁律

> 本文件是所有 AI 工具(omp / claude / codex / pi / qoder / kimi / grok / gemini…)在本仓库的**唯一规范入口**。
> 任何 AI 开工前必须先读完本文件;与你训练默认习惯冲突时,一律以本文件为准。
> 标注「CI 强制」的规则由 `.github/workflows/ci.yml` 机器把关,其余由 review 把关。

## 0. 文档落盘铁律(最高优先级)

**每一类产出有且只有一个去处。禁止自创目录,禁止在下表之外的位置新建 .md / .html。**

| 产出 | 唯一去处 | 命名 |
|---|---|---|
| 需求澄清 / 规划对话记录 | `docs/brainstorm/` | `YYYY-MM-DD-<slug>.md` |
| 能力调研 / 竞品盘点 | `docs/research/` | `<主题>.md` |
| 正式设计 spec(需求收敛后) | `docs/superpowers/specs/` | `YYYY-MM-DD-<slug>-design.md` |
| 交互设计原型(设计探索期) | `docs/design/` | `<主题>.html` |
| 设计文档配套 UI 原型(定稿前) | `docs/prototypes/` | `<主题>.html` |
| 评审记录(架构 / 平台 / 冗余) | `docs/review/` | `YYYY-MM-DD-<slug>.md` |
| 已落地的架构 / 契约 | `docs/architecture/` | `NN-<主题>.md`(两位编号递增) |
| 一次变更的契约 / 提案 | `openspec/changes/<change-id>/` | kebab-case change-id |

强制要求:

1. 每落盘一份文档,**必须**同步在 `docs/README.md`「文档索引」表登记一行(日期 / 链接 / 状态)。不登记 = 没落盘。
2. 设计 spec 必含四段:`日期` + `状态` 头、`背景与目标`、`方案取舍`(选定方案与被否决方案各附理由,写成对照)、`验证`。范本:`docs/superpowers/specs/2026-09-03-plugin-market-icons-design.md`。
3. 明令禁止:根目录散落文档(白名单仅 `README.md` / `AGENTS.md` / `LICENSE`)、把设计文档写进 `src/` 旁、在 `.pi/` `re-local/` `.claude/` 等本地产物目录放业务文档、自造 `docs/designs/` `NOTES.md` `PLAN.md` 之类平行体系。
4. 设计定稿并落地后,把结论沉淀进 `docs/architecture/`,不允许 architecture 停留旧貌。

## 1. 架构铁律(CI 强制)

分层固定,不得越界;违规即 CI 红:

| 规则 | 内容 | 检查命令 |
|---|---|---|
| 500 行铁则 | 单文件 ≤500 行(`.ts/.tsx/.rs/.css`;豁免须文件头 10 行内标 `file-size-exempt`) | `pnpm check:file-size` |
| R1 | `src/kernel/**` 不得 import 任何 plugins | `pnpm check:arch-boundary` |
| R3 | `@tauri-apps/*` 唯一 import 点是 `src/kernel/ipc.ts` | `pnpm check:arch-boundary` |
| R4 | `src/plugins/**` 不得反向 import app-shell(`@shell/*`) | `pnpm check:arch-boundary` |

- 新增 UI / CLI 能力的标准路径:新建 `src/plugins/<id>/` 实现 `Plugin` 接口 + 在 `src/plugins/index.ts` 的 `allPlugins` 数组注册一行;跨插件基础契约先沉淀进 `src/kernel/`,再由插件实现。
- 跨层 import 一律走别名 `@kernel` `@shell` `@plugins`(`tsconfig.json` / `vite.config.ts` 双处已配),不写长相对路径。
- PTY 幕布硬约束:`PTY bytes → pty://out/{sessionId} → xterm.js` 原样透传,**严禁**在幕布侧做消息气泡 / Markdown / Diff 二次渲染;一切增强(状态栏、引用、Git、文件树)发生在幕布之外。
- 内核不理解任何 CLI 私有格式;读取各家 session JSONL 只能经该 CLI 插件声明的适配器,缺失显示 `—`,不做猜测兜底。
- CLI 私有格式的跨插件共享沉淀进 `src/plugins/cli-shared/`(无生命周期共享格式库,非插件、不入 `allPlugins`):它是「跨插件契约进 kernel」与「内核不理解 CLI 私有格式」两条规则的缝隙层,准入标准 = 至少两个 cli-* 插件消费同一磁盘/HTTP 格式知识;feature 插件(welcome / workspace)经它消费 CLI 格式属合法通道,须在 import 处注释声明。

## 2. 验证(交付前必跑)

- 前端改动:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`
- Rust 改动(在 `src-tauri/` 下):`cargo test && cargo clippy --all-targets -- -D warnings && cargo fmt --check`
- UI 行为改动必须 `pnpm tauri:dev` 打开真实窗口目检交互,测试绿不算数。

## 3. 提交与风格(用户个人偏好)

- 提交信息:`type(scope): 中文一句话祈使句`;scope 用模块名(kernel / pty / git / files / composer / workspace / checkpoints / settings / welcome / 各插件 id…)。范本见 `git log --oneline`。
- 文档与注释用简体中文;标点为半角符号与中文混排(与现有文档一致);**不用 emoji**。
- 技术栈既定:React 19 + TypeScript(strict) + Tailwind 4 + xterm.js + Tauri 2(portable-pty / git2)。不引入新框架、新状态库、新 UI 组件库;确有必要,先在 spec 的「方案取舍」写明理由。
- 结论先行:文档与回复第一段就给决定和理由,不写铺垫和客套。

## 4. 冲突裁决

用户当次指令 > 本文件 > 你的通用默认。发现本文件与代码事实矛盾时:以代码为准,并顺手修订本文件。
