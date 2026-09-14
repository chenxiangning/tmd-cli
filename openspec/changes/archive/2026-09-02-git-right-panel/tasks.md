# Tasks: 右栏 Git 面板实装(git2 / libgit2)

> **v0.2**:合入 review 修订;布局改单视图三段;invalidate 命令删除;ahead/behind 独立
> **标签**:[E] 写代码 · [V] 验证 · [D] 决策评审 · [B] 基线前置

---

## 阶段 0:决策与基线

| ID | 标签 | 描述 | 验证 | 估算 |
|---|---|---|---|---|
| 0.1 | [D] | 决策 2.1 git2 vendored + BatchMode 兜底 | review 通过 | 0.5d |
| 0.2 | [D] | 决策 2.4 单视图三段布局(对齐截图) | review 通过 | 0.2d |
| 0.3 | [D] | 决策 2.5 E_* 结构化错误前缀 | review 通过 | 0.1d |
| 0.4 | [D] | §1.2 AI 生成按钮 MVP 砍掉 | review 通过 | 0.1d |
| 0.5 | [B] | 基线:`pnpm typecheck`/`vitest`/`check:file-size`/`check:arch-boundary` 全绿,记录输出 | 留档 | 0.1d |

---

## 阶段 1:M1 后端壳子(1d)

| ID | 标签 | 描述 | 验证 | 估算 |
|---|---|---|---|---|
| 1.1 | [E] | Cargo.toml:`git2 = { version="0.20", default-features=false, features=["vendored"] }`;`rust-version` 1.77→1.80 | `cargo build` 通过 | 0.1d |
| 1.2 | [E] | `git/mod.rs`:LazyLock 单层缓存 + with_repo + 内部 evict + canonicalize | 代码 | 0.1d |
| 1.3 | [E] | `git/error.rs`:E_* 前缀 5 类 + From 实现 | 单测:各前缀字符串稳定 | 0.1d |
| 1.4 | [E] | `git/status.rs`:compute(detached 安全)+ ahead_behind(独立) | 单测:tempdir repo | 0.15d |
| 1.5 | [E] | `git/commands.rs`:status / ahead_behind 两个命令 | 代码 | 0.05d |
| 1.6 | [E] | `lib.rs` 注册 + 删旧 `git.rs`(旧 `git_status` 命令迁移,前端无现存调用方——git 面板是占位) | grep 无残留 | 0.1d |
| 1.7 | [V] | 手测:sample repo / 非 git 目录 / detached HEAD 三场景 | 三态正确 | 0.1d |
| 1.8 | [V] | 基线四件套重跑,不劣化 | 全绿 | 0.05d |

---

## 阶段 2:M2 索引 + diff + 差异视图(2d)

| ID | 标签 | 描述 | 验证 | 估算 |
|---|---|---|---|---|
| 2.1 | [E] | `diff.rs`:list + file_patch(`Patch::from_diff`,line_stats 计数) | 单测:含 rename / binary / untracked | 0.3d |
| 2.2 | [E] | `index_ops.rs`:stage(含 deleted)/ unstage(reset_default)/ discard(不动 untracked),全走 fresh_index | 单测:外部 `git add` 后面板 stage 不冲突 | 0.3d |
| 2.3 | [E] | `commit.rs`:勾选提交(paths 先 stage)+ tree_id 空提交防线 + signature fallback | 单测:空提交返 E_EMPTY | 0.25d |
| 2.4 | [E] | 注册命令 3-8(diff_files/diff_file_patch/stage/unstage/discard/commit) | 代码 | 0.05d |
| 2.5 | [E] | 前端 `types.ts` + `gitOperations.ts`(15 方法,wrap 统一异常) | typecheck | 0.15d |
| 2.6 | [E] | `hooks/useGitStatus.ts`:5s 轮询 + visibilitychange 暂停 + refresh() | 单测:失焦 0 调用 | 0.15d |
| 2.7 | [E] | `hooks/useGitDiffs.ts`:文件清单 + patch LRU(50) | 单测:LRU 淘汰 | 0.15d |
| 2.8 | [E] | `GitPanel.tsx` 骨架:工具栏 + ViewSwitcher 下拉 + 空态(E_NOT_A_REPO) | 组件 | 0.2d |
| 2.9 | [E] | `views/DiffView.tsx`:聚合行 + FileList(checkbox/树形/平铺)+ PatchDrawer + CommitComposer | 组件 | 0.5d |
| 2.10 | [E] | 主题 token 缺口:琥珀/绿/红/sky 行背景 → themeTokens.ts 登记 | 不写死 hex | 0.1d |
| 2.11 | [V] | 手测 step 1-5 | 全过 | 0.15d |
| 2.12 | [V] | 基线四件套 + vitest | 全绿 | 0.05d |

**新包登记位**:diff 渲染若 DOM 版不达标,引入 `react-diff-view` 级包时在此登记行补一行(必要性 + 维护活跃度)。

---

## 阶段 3:M3 分支 + 历史视图(1.5d)

| ID | 标签 | 描述 | 验证 | 估算 |
|---|---|---|---|---|
| 3.1 | [E] | `branch_ops.rs`:list_all / checkout(safe + 脏工作区前置 confirm 契约)/ create / delete | 单测:detached / 同名拒 | 0.3d |
| 3.2 | [E] | `log.rs`:revwalk + 分页(offset/limit) | 单测 | 0.1d |
| 3.3 | [E] | 注册命令 9-13 | 代码 | 0.05d |
| 3.4 | [E] | `hooks/useGitBranches.ts` + `useGitLog.ts`(视图激活才拉) | 单测:未激活 0 调用 | 0.15d |
| 3.5 | [E] | `views/BranchView.tsx`:本地/远程分组 + 创建/删除/checkout + 当前分支高亮 | 组件 | 0.3d |
| 3.6 | [E] | `views/HistoryView.tsx`:log 列表 + commit patch 抽屉 | 组件 | 0.3d |
| 3.7 | [E] | composer 插件:`/commit <msg>` 前缀 → emit `git://composer-prefill`(不拦 PTY) | 单测:事件载荷 | 0.15d |
| 3.8 | [E] | git 插件监听 prefill 事件 → 切差异视图 + 预填 | 组件 | 0.1d |
| 3.9 | [V] | 手测 step 6-7 + composer 联动 | 全过 | 0.1d |

---

## 阶段 4:M4 remote + polish(1d)

| ID | 标签 | 描述 | 验证 | 估算 |
|---|---|---|---|---|
| 4.1 | [E] | `remote_ops.rs`:fetch/pull/push + GIT_TERMINAL_PROMPT=0 + BatchMode + E_AUTH 识别 | 单测:无 TTY 不挂死(超时断言) | 0.2d |
| 4.2 | [E] | 注册命令 14-15;pull 尊重用户 pull.rebase 配置 | 代码 | 0.05d |
| 4.3 | [E] | 工具栏 ⬆N ahead 计数(ahead_behind 事件驱动:fetch 后/切分支后/手动⟳) | 组件 | 0.15d |
| 4.4 | [V] | 手测 step 8-9(含无 upstream / SSH passphrase 机器实测挂死防线) | 全过 | 0.15d |
| 4.5 | [V] | `pnpm build:mac-arm64` 打包:通过 + 体积涨幅 <5MB + 启动涨幅 <200ms | 记录数值 | 0.2d |
| 4.6 | [V] | Windows/Linux 首次打包验证(无 CI,实机/VM);失败按 proposal §5.1 缓解 | 记录结果 | 0.2d |
| 4.7 | [E] | README.md 增 Git 模块段;proposal 状态 Draft→Verified | 文档 | 0.05d |

---

## 累计

| 阶段 | 工日 |
|---|---|
| 阶段 0 评审 | 1.0(不占开发) |
| M1 后端壳子 | 1.0 |
| M2 差异视图 | 2.0 |
| M3 分支/历史 | 1.5 |
| M4 remote+polish | 1.0 |
| **开发合计** | **5.5** |

---

## 风险哨兵

| 信号 | 触发点 | 处理 |
|---|---|---|
| libgit2-sys 编译失败 | 1.1 / 4.6 | 切系统依赖 + 打包脚本补 |
| status 轮询大仓库 >500ms | 2.11 手测感知 | proposal-3 提前:notify 事件驱动 |
| index stale(外部 git add 后面板脏) | 2.2 单测 | fresh_index 强制覆盖,禁止绕过 |
| composer 事件被当提交执行 | 3.7 评审 | 不变量:commit 仅面板按钮触发 |
| SSH passphrase 挂死 | 4.4 | BatchMode 双保险 + E_AUTH 引导 |

---

## DoD

- [ ] 全部 [E]/[V] 完成;基线四件套全绿
- [ ] 9 步手动验证全过
- [ ] macOS 打包通过;Win/Linux 打包结果留档
- [ ] README 更新;proposal Draft→Verified
- [ ] proposal-2 git-graph 占位文件建立

## Don't Do

- ❌ Git Graph 实装(留 disabled 入口即可)
- ❌ workspaceId / multi-repo / worktree
- ❌ GitHub 议题/拉取请求
- ❌ AI 生成 commit message 按钮(proposal-4)
- ❌ 任何形式"把提交指令反射回 PTY"
- ❌ 组件内写死色值 hex
- ❌ 绕过 fresh_index 直接 repo.index()
