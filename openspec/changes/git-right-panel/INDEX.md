# git-right-panel

右栏 Git 面板实装:git2(libgit2 vendored)后端 + 单视图三段布局(对齐 codemoss 外观)。

| 文件 | 角色 | 状态 |
|---|---|---|
| `proposal.md` | 决策层:范围 / 决策 / 验收 / 回滚 | Implemented v0.3 · 2026-09-02 实装完成,待验收 |
| `design.md` | 设计层:拐点论证 / 修正后实现 / UI 布局契约 | v0.3(随实装校订) |
| `tasks.md` | 执行层:5 阶段 36 任务 [E]/[V]/[D]/[B] | v0.3(实现完成,DoD 手动验收项未勾) |
| `specs/git-panel/spec.md` | 能力契约:11 条 Requirement + Scenario | v0.3 |

## v0.2 修订摘要(review 后)

- 6×P0 代码修正:diff 取 patch(Patch::from_diff)/ unstage(reset_default)/ discard(不动 untracked)/ 空提交(tree_id 比较)/ detached HEAD 安全 / stage 含 deleted
- 6×P1 架构修正:单层 Arc<Repository> 缓存(Repository 实为 Send+Sync)/ invalidate 命令删除改后端自治 / index.read(true) 防 stale / 命令数统一 15 / ahead-behind 独立命令 / GIT_TERMINAL_PROMPT=0 + BatchMode
- 布局:v0.1 三 Tab 作废 → 单视图纵向三段,对齐 codemoss 截图;AI 生成按钮砍出 MVP
- Composer 联动:纯事件总线预填,删除 PTY 反射(原设计会把文本发给 LLM)

## review 路径

1. `proposal.md` §0-2(范围+决策)→ §4-5(验收+回滚)
2. `design.md` §2(缓存模型)+ §3(6 处 P0 修正)+ §6(Composer 安全不变量)+ §8(布局契约)
3. `tasks.md` 阶段 0(评审项)+ 风险哨兵
4. `specs/git-panel/spec.md`(可验收的行为契约)
