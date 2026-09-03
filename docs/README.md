# tmd-cli 文档中心

> 项目规划与设计文档库。所有与 AI 的规划交互均落盘于此。
> AI 产出的落盘去处、命名与登记义务以根目录 `AGENTS.md` §0「文档落盘铁律」为准,下表是其展开;新文档不登记到索引视为未落盘。

## 目录结构

| 目录 | 用途 | 写入时机 |
|---|---|---|
| `brainstorm/` | 需求澄清对话记录（按日期归档） | 每次规划对话后追加 |
| `research/` | 调研与学习材料（mossx/codemoss 盘点 · CLI 能力矩阵 · omp CLI 课程） | 调研完成时 |
| `design/` | 交互设计原型 html（浏览器可打开） | 设计探索时 |
| `prototypes/` | 设计文档配套 UI 原型 html | 设计定稿前 |
| `review/` | 评审记录（架构 / 平台 / 冗余等） | 评审完成后 |
| `superpowers/` | superpowers 流程产出的正式设计 spec | 需求收敛后 |
| `architecture/` | 已落地的系统架构与契约 | 基础设施或架构调整后 |

## 文档索引

| 日期 | 文档 | 状态 |
|---|---|---|
| 2026-09-01 | [项目启动：为什么另起炉灶](brainstorm/2026-09-01-kickoff.md) | 进行中 |
| 2026-09-01 | [mossx 对话框能力盘点](research/mossx-composer-capabilities.md) | 已完成 |
| 2026-09-01 | [mossx Git 能力盘点](research/mossx-git-capabilities.md) | 已完成 |
| 2026-09-01 | [omp/pi/codex/claude/grok/kimi/qoder CLI 能力矩阵](research/cli-trigger-and-session-matrix.md) | 已完成 |
| 2026-09-01 | [omp CLI 学习笔记(14 课主课 + prompts/ 用户速查)](research/omp-cli-course/README.md) | 已完结 |
| 2026-09-03 | [omp 最近版本升级记录(v18.0.7-18.1.6)](research/omp-cli-course/releases.md) | 持续更新 |
| 2026-09-01 | [基础架构总览](architecture/01-overview.md) | 已落地(09-03 校准) |
| 2026-09-01 | [代码级架构（Mermaid）](architecture/02-code-architecture.md) | 对齐当前代码(09-03 校准) |
| 2026-09-01 | [Composer 工具栏设计](superpowers/specs/2026-09-01-composer-toolbar-design.md) | 已确认 |
| 2026-09-01 | [Composer 富输入框设计原型](design/composer-design.html) | 已落地 |
| 2026-09-01~02 | [UI 原型:composer 工具栏 / 欢迎页额度 / 设置面板 / 消息锚点栏 / git 文件列表 ×3 / 批审阅面板 / 插排](prototypes/) | 设计定稿配套 |
| 2026-09-02 | [Composer 命令抽屉交互原型](design/composer-drawer-demo.html) | 已落地 |
| 2026-09-02 | [会话列表展示探索 v1 / v2](design/session-list-showcase.html) | 设计原型 |
| 2026-09-02 | [checkpoints 批次审批设计](superpowers/specs/2026-09-02-checkpoints-batch-review-design.md) | 已落地(09-03 校准增量) |
| 2026-09-02 | [插件市场（插排）设计](superpowers/specs/2026-09-02-plugin-market-strip-design.md) | 已确认 |
| 2026-09-02 | [架构与插件化合规评审](review/2026-09-02-architecture.md) | 已完成 |
| 2026-09-02 | [跨平台兼容性评审](review/2026-09-02-platform.md) | 已完成 |
| 2026-09-02 | [冗余与死代码评审](review/2026-09-02-redundancy.md) | 已完成(09-03 复核处置,见文末) |
| 2026-09-02 | [每日评审](review/2026-09-02-daily-review.md) | 已完成 |
| 2026-09-03 | [插排徽标升级设计](superpowers/specs/2026-09-03-plugin-market-icons-design.md) | 已评审通过 |
| 2026-09-03 | [会话标题 tab 条设计](superpowers/specs/2026-09-03-session-title-tabs-design.md) | 已落地 |
| 2026-09-03 | [父子会话层级原型:方案 B 定稿(父节点即开关,保留 FLUX 时间轴)](design/session-hierarchy-schemes.html) | 设计原型 |
| 常态 | [功能清单 FEATURES](FEATURES.md) | 随代码演进(09-03 全域代码校准) |

变更契约不在本目录:进行中见 `openspec/changes/`,已归档见 `openspec/changes/archive/`,正式能力规格见 `openspec/specs/`。
