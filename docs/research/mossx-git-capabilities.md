# mossx Git 能力调研（tmd-cli 复用参考）

> 调研对象：`mossx/src/features/git/` + `mossx/src-tauri/src/git/`（含 `git_utils.rs`、`workspaces/{git,worktree}.rs`、`bin/cc_gui_daemon/git.rs`）
> 调研日期：2026-09-01。LOC 为实测行数（`~` 为按字节数估算）。

---

## 1. 能力清单（用户可见能力）

### 1.1 变更 / Stage / Commit

| 能力 | 说明 | 关键文件 | LOC |
|---|---|---|---|
| 状态读取 | staged/unstaged 文件列表、ahead/behind、rename 检测 | `src-tauri/src/git/commands.rs` → `mod.rs`（git2） | hook `useGitStatus.ts` 256 |
| 多仓库状态 | workspace 内多 git root 扫描与聚合 | `components/GitMultiRepositoryChanges.tsx`、`hooks/useMultiRepositoryGitStatus.ts`、`utils/gitRepositorySummary.ts` | 454 + ~120 + ~200 |
| Stage/Unstage | 单文件/批量/全部，rename 双路径处理 | `commands.rs`（`git add` / `git restore --staged`） | 含于 commands.rs 2347 |
| 丢弃变更 | revert 单文件/批量/全部，带确认对话框 | `commands.rs`（`git checkout --`）、`GitDiffPanel.tsx` DiscardDialog | 同上 |
| Commit | 提交 + 按选区（commit scope）提交 | `commands.rs` `commit_git`、`utils/commitScope.ts` | — |
| AI 提交信息 | 多引擎生成提交信息（走 CLI 引擎） | `components/GitCommitComposer.tsx`、`CommitMessageEnginePicker.tsx`、`hooks/useCommitMessageGenerationMenu.ts` | 328 + ~120 |
| 变更内联编辑 | 在 diff 预览里直接编辑文件草稿并保存 | `components/WorkspaceEditableDiffReviewSurface.tsx`、`WorkspaceEditableDiffCompare.tsx` | 469 + 383 |
| 代码标注 | diff 行上挂 code annotation | `GitDiffPanelTypes.ts`（CodeAnnotationBridgeProps） | 横切 |

### 1.2 Diff 查看

| 能力 | 说明 | 关键文件 | LOC |
|---|---|---|---|
| 工作区 diff 列表 | flat/tree 两种视图、折叠、行数统计 | `components/GitDiffPanelFileSections.tsx`、`utils/diffTree.ts` | 757 + ~150 |
| Diff 渲染器 | split/unified、语法高亮、块折叠 | `components/GitDiffViewer.tsx`、`DiffBlock.tsx` | 1424 + 363 |
| 文件完整 diff | 单文件全量 patch（大文件分页加载） | `commands.rs` `get_git_file_full_diff`（git2 + CLI 兜底） | — |
| 图片 diff | base64 新旧图对比卡 | `components/ImageDiffCard.tsx`、`git_utils.rs` `build_image_commit_diff` | 159 |
| 语义 diff 摘要 | 变更语义化归纳（供 AI 用） | `utils/semanticDiffSummary.ts` | ~800 |
| Diff 预览模态 | 点击文件弹全屏/可编辑 diff modal | `GitDiffPanel.tsx` 内 portal | 含于 3082 |

### 1.3 分支操作

| 能力 | 说明 | 关键文件 | LOC |
|---|---|---|---|
| 分支列表 | 本地/远程、ahead/behind、last commit | `commands_branch.rs` `list_git_branches`、`hooks/useGitBranches.ts` | 255（hook） |
| Checkout / 新建 / 从分支建 / 从提交建 | 脏工作区保护（报错提示 commit/stash/discard） | `commands_branch.rs` | 含于 1809 |
| 删除 / 重命名 | force 删除支持 | `commands_branch.rs` | — |
| Merge / Rebase | 冲突时直接透传 CLI 错误文本，**无冲突解决 UI** | `commands_branch.rs` `merge_git_branch` / `rebase_git_branch` | — |
| 分支更新（pull --rebase 类） | `update_git_branch` | `commands_branch.rs`、`utils/gitBranchUpdateFeedback.ts` | — |
| 分支对比 | 两分支 commit 集对比、分支间 diff、单文件 diff | `commands_branch.rs` `get_git_branch_compare_commits` 等 3 个 | — |

### 1.4 历史

| 能力 | 说明 | 关键文件 | LOC |
|---|---|---|---|
| Log | 分页 log、refs 标注 | `commands.rs` `get_git_log`（git2 revwalk）、`hooks/useGitLog.ts` | 123（hook） |
| 提交历史（过滤） | 按分支/作者/关键字过滤 | `commands.rs` `get_git_commit_history` | — |
| 提交详情 + diff | 单提交元信息、文件变更、patch | `commands.rs` `get_git_commit_details` / `get_git_commit_diff` | — |
| Blame | 文件逐行 blame | `commands.rs` `get_git_file_blame`、`git_utils.rs` `build_git_file_blame` | — |
| cherry-pick / revert commit / reset | soft/mixed/hard reset | `commands.rs` | — |
| 文件历史 | 单文件历史视图 | `features/git-history/components/FileHistoryView.tsx` | 邻近 feature |

### 1.5 远程 / 同步

| 能力 | 说明 | 关键文件 | LOC |
|---|---|---|---|
| push / pull / fetch / sync | 全部 shell 到 `git` CLI；HTTP2 transport 错误识别 | `commands.rs` `push_git` / `pull_git` / `sync_git` / `git_fetch` | — |
| push preview | push 前预览待推提交 | `commands.rs` `get_git_push_preview` | — |
| remote 信息 | origin URL → GitHub repo 解析 | `commands.rs` `get_git_remote`、`git_utils.rs` `parse_github_repo` | — |

### 1.6 GitHub / PR

| 能力 | 说明 | 关键文件 | LOC |
|---|---|---|---|
| Issues / PR 列表 / PR diff / PR 评论 | 走 `gh` CLI（token 隔离环境） | `commands.rs` `get_github_*` ×4、`hooks/useGitHub*.ts` ×4 | hooks ~320 |
| PR 创建工作流 | 分阶段（precheck→branch→push→pr）+ range gate | `commands_pr_workflow.rs`、`range_gate.rs`、`hooks/usePullRequestComposer.ts` | 843 + 120 + ~170 |
| PR 内容 AI 生成 | 生成 PR title/body | `pull_request_content.rs` | 525 |
| GitHub 面板数据 | 前端聚合 surface | `components/GitHubPanelData.tsx` | 154 |

### 1.7 其他

| 能力 | 说明 | 关键文件 | LOC |
|---|---|---|---|
| Worktree 对比 | worktree vs 分支 diff | `commands_branch.rs` `get_git_worktree_diff_*` ×2 | — |
| Stash | **仅菜单项 + i18n 文案，无后端命令**（`gitRepositoryActions.ts` 有 id，forwarding matrix 无对应项） | `types/gitRepositoryActions.ts` | 桩 |
| 冲突解决 | **无**；merge/rebase 冲突只透传错误文本 | — | 0 |
| Tag / manage-remotes / clone | 菜单 id 存在，后端命令缺失或半接线 | `types/gitRepositoryActions.ts` | 桩 |
| 远程模式转发 | 所有命令可转发到 `cc_gui_daemon` 执行 | `mod.rs` forwarding matrix（58 条）、`bin/cc_gui_daemon/git.rs` | matrix ~420 + daemon 侧大量 |

---

## 2. 后端机制：git2 与 CLI 混合

**结论：读走 `git2`（libgit2 Rust binding），写一律 shell out 到 `git` CLI，GitHub 走 `gh` CLI。**

| 层 | 机制 | 文件 |
|---|---|---|
| 读：status / diff / log / commit details / blame / 分支对比 | `git2` crate（`Repository`、`StatusOptions`、`DiffOptions`、revwalk） | `src-tauri/src/git/mod.rs`（2612 行，核心逻辑 + 测试） |
| 写：stage / unstage / revert / commit | `git add -A` / `git restore --staged` / `git checkout --` / `git commit`，经 `run_git_command()` → `resolve_git_binary()` | `src-tauri/src/git/commands.rs`（2347 行，Tauri 命令入口 + 本地回退实现） |
| 写：push / pull / fetch / sync / cherry-pick / reset / merge / rebase / branch mutation | 同上，全部 CLI | `commands.rs`、`commands_branch.rs`（1809 行） |
| GitHub API | `gh` CLI，`run_token_isolated_command()` 注入隔离 token 环境 | `mod.rs:1519` |
| 共享 helper | rename 检测、image diff、repo root 扫描、blame 构建 | `src-tauri/src/git_utils.rs`（1401 行） |
| 远程模式 | 每个命令先查 `is_remote_mode`，命中则 JSON-RPC 转发 daemon | `mod.rs` `GIT_REMOTE_FORWARDING_MATRIX`（58 方法）、`bin/cc_gui_daemon/git.rs` |
| Worktree 路径 | 纯路径工具（sanitize/unique），非 git 操作 | `workspaces/worktree.rs` |

后端 LOC 合计：`git/` 目录 ≈ 9350（commands.rs 2347 + commands_branch.rs 1809 + commands_pr_workflow.rs 843 + mod.rs 2612 + pull_request_content.rs 525 + range_gate.rs ~120 + validation.rs 极小），加 `git_utils.rs` 1401 ≈ **10.7k**。前端 `src/features/git/` 非测试 ≈ **14–15k**（components ~9.5k + hooks ~2.5k + utils ~2.5k；另有 ~10 个 part 测试文件未计）。

---

## 3. tmd-cli Keep / Cut 建议

### 3.1 保留（core）

| 能力 | mossx 源 | 裁剪说明 | 估算 LOC |
|---|---|---|---|
| 状态 + stage/unstage + discard + commit | `commands.rs` 前 1/3 + `useGitStatus` | 去掉多仓库聚合、commit scope 选区 | Rust ~500 / TS ~350 |
| Diff 列表 + 渲染 | `GitDiffPanelFileSections.tsx`（flat 视图即可）、`GitDiffViewer.tsx` + `DiffBlock.tsx` | 砍 tree 视图、editable diff、annotation、图片 diff | TS ~2200 |
| Commit composer | `GitCommitComposer.tsx` | 纯文本框 + 提交按钮；AI 生成可留接口 | TS ~200 |
| 分支 list / checkout / create / delete | `commands_branch.rs` 前 4 命令 + `useGitBranches` | 砍 merge/rebase/update/对比 | Rust ~300 / TS ~250 |
| 历史 log + 提交详情/diff | `commands.rs` `get_git_log` / `get_git_commit_*` + `useGitLog` | 砍过滤、blame、cherry-pick/reset | Rust ~350 / TS ~250 |

**Core 子集估算：Rust ~1200 行 + TS ~3300 行 ≈ 4.5k LOC**（mossx 现状约 25k，砍幅 ~82%）。

机制建议：tmd-cli 目标环境必有 `git` CLI，**读写全部 shell out 到 `git`**（`git status --porcelain=v2`、`git diff`、`git log`），不引 `git2` 依赖，可再省掉 mossx 中 git2 特有的 rename/blame/image 处理代码；且与 tmd-cli “PTY 包 CLI” 的轻量定位一致。

### 3.2 砍掉（heavy）

| 能力 | 理由 |
|---|---|
| 多仓库聚合（`GitMultiRepositoryChanges` 等 ~2.5k） | tmd-cli 单 workspace 单 repo 足够 |
| Worktree 对比 / `workspaces/worktree.rs` | 属 workspace 编排，非 git 面板 |
| PR 工作流 + GitHub 面板（~2.5k Rust + ~1k TS） | 依赖 `gh` CLI 与 AI 引擎，重；留给 CLI TUI 自身（用户直接跑 `gh`） |
| AI 提交信息引擎选择器 | 与 CLI 引擎耦合，tmd-cli 可用 CLI 自身生成 |
| Editable diff / 代码标注 / 语义 diff 摘要（~1.7k TS） | 编辑器能力，超出 git 面板 |
| Merge/rebase 冲突流 | mossx 本身也只做错误透传，无价值可搬 |
| 远程模式 daemon 转发（matrix 58 条） | tmd-cli 无 daemon 架构 |
| Stash/tag/remotes 菜单桩 | mossx 自己都没实现 |

---

## 4. UI Surface 清单（供 right-sidebar tab + header/footer 挂载规划）

| Surface | 组件 | 挂载方式（mossx 现状） | tmd-cli 映射建议 |
|---|---|---|---|
| **变更面板（主面板）** | `GitDiffPanel.tsx`（3082） | `useLayoutNodes.tsx:2494` 懒加载挂入侧栏；`mode`（diff/log/…）切换 | 右侧 sidebar 一个 “Git” tab 主体 |
| 面板头部模式选择器 | `GitDiffPanel` 内 mode menu + `headerControlsTarget` portal | **portal 到外部 header DOM**（`gitModeControlsTarget`），布局/焦点保持 | 直接复用此模式：portal 挂到 header 插槽 |
| 文件分区列表 | `GitDiffPanelFileSections.tsx`（757）：staged/unstaged 两 section + `GitDiffPanelSectionActions`（section 级 stage/discard） | 面板内 | 面板内 |
| 文件右键菜单 | `GitDiffPanelFileContextMenu.ts`（~90）：stage/unstage/discard/history | 面板内 | 面板内（可砍 history） |
| Commit composer | `GitCommitComposer.tsx`（328）+ `CommitMessageEnginePicker` | 面板顶部/底部，`useGitCommitComposerPlacement` 决定位置 | **footer 挂载点**：输入框 + commit 按钮 |
| Diff 渲染 | `GitDiffViewer.tsx`（1424）+ `DiffBlock.tsx`（363） | 面板行内展开 + 模态预览两处复用 | 面板行内展开即可 |
| Diff 预览模态 | `GitDiffPanel` 内 portal（`.git-history-diff-modal`） | portal 到 body，可最大化 | 保留，低成本高价值 |
| 多仓库变更区 | `GitMultiRepositoryChanges.tsx`（454） | 面板内 section | 砍 |
| GitHub 数据区 | `GitHubPanelData.tsx`（154） | 面板内 | 砍 |
| 历史面板 | `features/git-history/components/GitHistoryPanel.tsx`（190 壳 + `git-history-panel/GitHistoryPanelImpl.tsx`） | 独立 appMode `gitHistory` 全屏面板，含分支树、graph cell、commit 过滤 | 降级为 Git tab 内 “History” 子视图（log 列表 + 详情 diff） |
| Worktree 变更面板 | `GitHistoryWorktreePanel.tsx`（1190） | 历史面板内嵌 | 砍 |
| 仓库右键菜单动作 | `types/gitRepositoryActions.ts`（20 个 action id，发布/订阅 intent） | 侧边栏仓库条目右键 | 只保留 push/pull/fetch/show-diff 四项 |

### 可复用的挂载模式（mossx 已验证）

1. **headerControlsTarget portal**：面板内部把模式切换器 portal 到 header DOM 节点——tmd-cli 的 header 挂载可直接照搬。
2. **懒加载 + 样式门禁**：`GitDiffPanel` 外层 `useFeatureStylesReady(loadDiffStyles)`，样式未就绪不渲染业务 DOM。
3. **props 全回调化**：面板不直连 Tauri invoke，数据/动作全部经 props 注入（`useLayoutNodes` 组装），tmd-cli 可在自己的 shell 层重新接线。

---

## 5. 关键结论

1. mossx git 是 **git2（读）+ git CLI（写）+ gh CLI（GitHub）** 的混合后端，Tauri 命令层薄、核心逻辑在 `git/mod.rs` + `commands.rs`。
2. **无 stash、无冲突解决、无 tag 实现**——这三项是菜单桩，不能作为参照。
3. 前端核心资产是 `GitDiffPanel` 一族（变更列表 + diff 渲染 + composer + modal），历史/多仓库/GitHub 是独立重资产，tmd-cli 应只搬前者。
4. Core 子集 ≈ **4.5k LOC**（Rust 1.2k + TS 3.3k），且建议 tmd-cli 后端改为纯 `git` CLI shell-out，进一步去掉 git2 依赖。
