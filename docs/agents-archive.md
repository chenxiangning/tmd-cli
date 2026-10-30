# AGENTS.md 迁出规则归档(tmd-lint)

# AGENTS.md 迁出规则归档(tmd-lint)

- | 交互设计原型(设计探索期) | `docs/design/` | `<主题>.html` |
- - CLI 私有格式的跨插件共享沉淀进 `src/plugins/cli-shared/`(无生命周期共享格式库,非插件、不入 `allPlugins`):它是「跨插件契约进 kernel」与「内核不理解 CLI 私有格式」两条规则的缝隙层,准入标准 = ≥2 个 cli-* 插件消费同一磁盘/HTTP 格式知识,或 1 个 cli-* + feature 插件(welcome / workspace / composer / memory-coordinator 等 feature 插件)联合消费(文件头注释声明先例);另,横跨 ≥3 家 CLI 家族的格式知识(单一家族插件无法持有,如 sessionUsage 的 omp/pi/claude/codex 用量行)允许 ≥2 个 feature 插件联合消费进 cli-shared,文件头注释声明先例。同族变体共享声明(glyph/静态表,如 qoder 双插件)视同满足。feature 插件经它消费 CLI 格式须在 import 处注释声明。
- | 一次变更的契约 / 提案 | `openspec/changes/<change-id>/` | kebab-case change-id |
- | 已落地的架构 / 契约 | `docs/architecture/` | `NN-<主题>.md`(两位编号递增) |
- | 评审记录(架构 / 平台 / 冗余) | `docs/review/` | `YYYY-MM-DD-<slug>.md` |
- | 设计文档配套 UI 原型(定稿前) | `docs/prototypes/` | `<主题>.html` |
- | 正式设计 spec(需求收敛后) | `docs/superpowers/specs/` | `YYYY-MM-DD-<slug>-design.md` |
- | 能力调研 / 竞品盘点 | `docs/research/` | `<主题>.md` |
- | 需求澄清 / 规划对话记录 | `docs/brainstorm/` | `YYYY-MM-DD-<slug>.md` |
