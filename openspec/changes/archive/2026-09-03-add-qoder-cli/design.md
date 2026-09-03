## Context

本机实证（2026-09-02，qodercli 1.1.33 / qoderclicn 1.1.28）：

| 维度 | 国际版 | 国内版 |
|---|---|---|
| 二进制 / npm | `qodercli` / `@qoder-ai/qodercli` | `qoderclicn` / `@qodercn-ai/qoderclicn` |
| 数据目录 | `~/.qoder/` | `~/.qoder-cn/` |
| 会话存储 | `projects/<slug>/<uuid>.jsonl` | 同构 |
| 官方文档 | docs.qoder.com | docs.qoder.cn |

- slug 规则与 claude 完全一致：`cwd.replace(/[^a-zA-Z0-9]/g, "-")`（实证 codemoss 项目目录名逐字符吻合，含 CJK 逐字替换）
- jsonl 为 claude fork 行型：用户行带 `origin.kind:"human"` 判别字段；assistant 行 `message.model` 落盘（实证 `qmodel_38max` / `lite`）；错误帧 `isApiErrorMessage:true` 且 model 为 `<synthetic>`
- 思考强度不落会话文件，只在 settings.json `model.preferences[<name>].reasoning.effort`

## Goals / Non-Goals

- Goals: 双版独立接入，能力对齐 claude 插件（会话列表 / resume / 模型状态 / 锚点栏 / 默认状态）
- Non-Goals: quota 面板（后续单独变更）；`@` 文件引用与 `$` skill 翻译（未实证）；远程会话（`--remote` 系列不进 profile）

## Decisions

### D1: 两个完全独立插件目录 + cli-shared 共享层（用户定夺）

`cli-qoder/` 与 `cli-qoder-cn/` 各自完整实现（变体常量 / profile 接线），只有同一 CLI 的同一磁盘格式知识（slug / 行型 / status 解析 / glyph）进 `cli-shared`。理由：两分发版未来可能分叉（国内版功能面独立演进），目录级隔离让分叉成本局部化；共享层只沉淀磁盘格式这个稳定事实。

### D2: 锚点行型以 `origin.kind === "human"` 为判别字段

qoder 用户行是 claude 行型超集。`claudeUserMessageLine` 依赖 isSidechain + 包装判定；qoder 额外携带 `origin.kind`，是"真实人工输入"的最强判别（工具结果 / 注入行不具备）。单独声明 `qoderUserMessageLine`，不复用 claude 行型，避免两 CLI 契约暗中耦合。

### D3: 会话模型提取跳过错误帧

assistant 行 `message.model` 是模型真相，但 credit 耗尽 / 鉴权失败时 CLI 落 `<synthetic>` 错误帧（`isApiErrorMessage:true`，本机实证）。提取器跳过错误帧继续倒扫，取更早的真实模型 —— 工具栏显示 `qmodel_38max` 而非 `<synthetic>`。

### D4: 触发符只声明 `/` command（纯透传）

会话内 skill_listing 实证 5 个内置 skill（simplify / quest / mcp-config / loop / run）+ 错误文案实证 `/feedback`，全部 `/name` 原生语法。`$` 翻译（omp/claude 方案）与 `@` 文件引用均未在 qoder 侧实证，不猜接口 —— 不声明。

## Risks / Trade-offs

- 共享层 `qoderProjectSlug` 与 claude 插件 `claudeProjectSlug` 存在一行同构实现：qoder 侧独立命名，不回改 claude（微创原则，两 CLI 契约独立演进）
- qoder 为快速演进的 claude fork，jsonl 行型可能变：解析器全部纯函数 + 单测守护契约，坏行跳过不崩
- `origin.kind` 守卫若未来版本缺失字段会导致锚点降级：可接受（宁缺毋错）

## Migration Plan

纯新增 + 两处注册点各 2 行；无存量行为改动。回滚 = revert 单提交。

## Open Questions

（无）
