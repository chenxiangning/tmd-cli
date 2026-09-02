# tmd-cli 文档中心

> 项目规划与设计文档库。所有与 AI 的规划交互均落盘于此。

## 目录结构

| 目录 | 用途 | 写入时机 |
|---|---|---|
| `brainstorm/` | 需求澄清对话记录（按日期归档） | 每次规划对话后追加 |
| `research/` | 对 codemoss / mossx 的调研与能力提炼 | 调研完成时 |
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
| 2026-09-01 | [基础架构总览](architecture/01-overview.md) | 骨架已落地 |
| 2026-09-01 | [代码级架构（Mermaid）](architecture/02-code-architecture.md) | 对齐当前代码 |
| 2026-09-02 | [Composer 命令抽屉交互原型](design/composer-drawer-demo.html) | 设计原型 |
| 2026-09-02 | [架构与插件化合规评审](review/2026-09-02-architecture.md) | 已完成 |
| 2026-09-02 | [跨平台兼容性评审](review/2026-09-02-platform.md) | 已完成 |
| 2026-09-02 | [冗余与死代码评审](review/2026-09-02-redundancy.md) | 已完成 |
| 2026-09-02 | [插件市场（插排）设计](superpowers/specs/2026-09-02-plugin-market-strip-design.md) | 已确认 |
