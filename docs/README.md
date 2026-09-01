# tmd-cli 文档中心

> 项目规划与设计文档库。所有与 AI 的规划交互均落盘于此。

## 目录结构

| 目录 | 用途 | 写入时机 |
|---|---|---|
| `brainstorm/` | 需求澄清对话记录（按日期归档） | 每次规划对话后追加 |
| `research/` | 对 codemoss / mossx 的调研与能力提炼 | 调研完成时 |
| `decisions/` | ADR 架构决策记录（编号 + 上下文 + 结论） | 每个关键决策拍板时 |
| `specs/` | 正式设计文档（评审通过后生效） | 需求收敛后 |
| `architecture/` | 已落地的系统架构与契约 | 基础设施或架构调整后 |

## 文档索引

| 日期 | 文档 | 状态 |
|---|---|---|
| 2026-09-01 | [项目启动：为什么另起炉灶](brainstorm/2026-09-01-kickoff.md) | 进行中 |
| 2026-09-01 | [mossx 对话框能力盘点](research/mossx-composer-capabilities.md) | 已完成 |
| 2026-09-01 | [mossx Git 能力盘点](research/mossx-git-capabilities.md) | 已完成 |
| 2026-09-01 | [omp/pi/codex CLI 能力矩阵](research/cli-trigger-and-session-matrix.md) | 已完成 |
| 2026-09-01 | [基础架构总览](architecture/01-overview.md) | 骨架已落地 |
