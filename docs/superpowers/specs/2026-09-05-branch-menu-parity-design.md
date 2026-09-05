# 分支右键菜单对齐 codemoss:变基 / 合并 / 对比 / 重命名 / 自指定分支新建

日期:2026-09-05
状态:已落地(Rust 155 测试/前端 775 测试/typecheck/arch/file-size/build 全绿;交互待真实窗口目检)

## 背景与目标

tmd-cli 分支右键菜单现有:切换 / 检出到本地 / 更新 / 获取 / 推送 / 删除。对照 codemoss git graph 分支菜单(签出 / 从 X 新建分支 / 签出并变基到当前 / 与当前比较 / 显示与工作树的差异 / 将当前变基到 X / 将 X 合并到当前 / 更新 / 推送 / 重命名 / 删除),缺 7 项能力;另「推送」菜单项目前是裸 `git pull_push push`,codemoss 语义为打开推送对话框(面板 PushDialog 已具备,未提交变更内)。

目标:菜单 11 项与 codemoss 全量对齐(含禁用规则与文案语义),tmd-cli 已有的更新(当前 pull / 非当前仅 ff / 远端 fetch)与删除(未合并保护 + 两步 force)保持现状;获取(单分支引用刷新)为 tmd-cli 超集保留。

缺口清单:

| codemoss 菜单项 | tmd-cli 现状 | 动作 |
|---|---|---|
| 头部 `main -> origin/main` | 已有跟踪摘要头 | 无 |
| 签出 | 已有切换/检出(+脏区暂存并切换) | 无 |
| 从 X 新建分支... | 后端 `git_create_branch(from)` 已支持起点,缺菜单入口与对话框 | 补前端 |
| 签出并变基到 \<current\> | 无 | 新增(前端 checkout + 新 rebase) |
| 与 \<current\> 比较 | 无 | 新增(双向 revwalk + 双列提交弹窗) |
| 显示与工作树的差异 | 无 | 新增(文件列表 + 单文件 patch 中央 tab) |
| 将 \<current\> 变基到 \<branch\> | 无 | 新增 |
| 将 \<branch\> 合并到 \<current\> 中 | 无 | 新增 |
| 更新 | 已有且更细(当前 pull / 非当前 ff / 远端 fetch) | 无 |
| 推送... | 菜单为裸推送;面板已有 PushDialog | 菜单改开对话框 |
| 重命名... | 无 | 新增 |
| 删除 | 已有(未合并保护) | 无 |

## 方案取舍

**选定:merge / rebase / rename shell-out git CLI;对比与工作树 diff 走 git2 进程内。**

- merge/rebase/rename 复用 `remote_ops::exec_git`(改 `pub(super)`):非交互环境、总时长上限、双管道排空、`E_SHELL` 错误分类全部现成。rebase 选 CLI 是正确性取舍:libgit2 rebase 需逐提交驱动(checkout + commit 循环),冲突状态机复杂易错;CLI 一条命令留下标准 `.git/rebase-merge` 中间态,用户可在幕布终端 `git rebase --continue/--abort` 收尾,与 codemoss 行为一致。rename 用 `git branch -m` 保证 `branch.<name>.remote/merge` upstream 配置随迁,行为与 git 官方完全一致。均为用户触发低频操作,单进程 spawn 无性能热点。
- 对比(branch compare)复用 codemoss 算法:双向 revwalk `push(target)/hide(current)` 与反向,`Sort::TOPOLOGICAL | TIME`,limit 缺省 200、clamp 1..500;返回复用现有 `LogEntry`(refs 装饰直接走 `log.rs` 现成 `entry()`),契约零新增提交类型。
- 工作树对分支的 diff:**重新实现**(用户明确要求:逻辑可复用但有性能问题处重写)。codemoss 是 spawn `git diff --name-status` + 文本解析、patch 另起第二条 CLI;此处改 git2 `diff_tree_to_workdir_with_index` + `find_similar` 进程内完成,列表只回 `path/oldPath/status` 不带 patch,单文件 patch 按需走同款 diff + `Patch::from_diff`(与 `diff.rs::file_patch` 同源模式)。零进程、零文本解析;列表与 patch 拆分这一性能设计照搬。

**否决:merge/rebase 用 libgit2 原语实现。** merge 需自写 merge commit(analysis → fast_forward / merge_commits → write_tree → commit),rebase 需逐提交驱动循环;两条路径都要自己维护冲突中间态兼容性,而 CLI 版本零自研状态机、中间态与官方 git 完全互通(幕布终端可直接接管)。

**否决:对比结果搬 codemoss 的全量 details 缓存 + 内嵌 diff viewer。** codemoss 在 modal 内自建提交详情缓存(`branchCompareDetailsCacheRef`)与 GitDiffViewer;tmd-cli 已有等价按需设施:提交行点击复用 `openCommitDiffTab`(中央 tab,`git_commit_files`/`git_commit_file_patch` 按需拉),文件行点击开新 `git-branch-diff` tab。零新增缓存与第二套 diff 渲染。

**否决:菜单推送项继续裸推送。** 面板 PushDialog 已有预览/Gerrit/force-with-lease,菜单打开同一对话框(codemoss 同语义)而非复制第二份推送逻辑;经 panelStore 新信号触发(GitPanel 持有 dialog state,BranchView 为子组件,与 `refreshNonce` 同款 store 信号模式)。

## 改动面

### 后端(src-tauri/src/git/)

| 命令 | 实现 | 返回 |
|---|---|---|
| `git_merge_branch(cwd, name)` | CLI `git merge <name>`(exec_git);冲突/脏区由 git 自身报错,`E_SHELL` 透传,仓库留标准 MERGE_HEAD 中间态 | `()` |
| `git_rebase_branch(cwd, onto)` | CLI `git rebase <onto>`;同上,冲突留 rebase-merge 中间态 | `()` |
| `git_branch_worktree_patch(cwd, branch, path)` | 同款 diff + delta 索引定位 + `Patch::from_diff`(同 `diff.rs` 模式) | `Option<FilePatch>`(复用) |
| `git_commit_message(cwd, sha)` | commit.message() 全文(对比详情面板 message 块) | `String` |
| `git_branch_compare(cwd, target, current, limit?)` | git2 双向 revwalk push/hide,topo+time,limit 200 clamp;target==current 返回双空 | `BranchCompareSet{targetOnly, currentOnly: LogEntry[]}` |
| `git_branch_worktree_files(cwd, branch)` | git2 branch tree → `diff_tree_to_workdir_with_index` + find_similar,只出清单 | `Vec<BranchDiffFile{path, oldPath, status}>` |
| `git_branch_worktree_patch(cwd, branch, path)` | 同款 diff + delta 索引定位 + `Patch::from_diff`(同 `diff.rs` 模式) | `Option<FilePatch>`(复用) |

写三条走 `run_mut` + `evict_cwd`;读三条走 `run`。merge/rebase/rename 实现落 `branch_ops.rs`(分支写操作内聚),对比与工作树 diff 新建 `compare_ops.rs`。

### 前端(src/plugins/git/ + kernel)

- `kernel/gitContract.ts`:`GitBranchCompareSet`、`GitBranchDiffFile`;`kernel/ipc.ts`:6 个封装。
- `views/BranchContextMenu.tsx`:按 codemoss 顺序补 7 项,禁用规则同款(busy 全局禁;签出并变基/变基/合并/删除禁 current+remote;比较禁 current;重命名禁 remote;推送仅 current 可用)。
- `views/BranchCompareModal.tsx`(重写):codemoss 同构——头部「分支对比」徽标 + 标题/副标题 +「独有提交 N 个」;左列上下两个可折叠「独有」分区(集合差标注 +「N 个提交」胶囊 + 空态「该方向无独有提交。」),提交卡选中高亮、自动选中第一个;右列 `CommitDetailsPanel`(摘要、sha 胶囊、完整 message 块、「N 个文件 · ++X / --Y」、状态徽标 + 逐文件 ± 的文件列表,点文件看单文件 patch)。worktree 模式 `WorktreeDiffPanel`(左 patch + 右文件列表)。
- 新增 `views/CommitDetailsPanel.tsx`、`WorktreeDiffPanel.tsx`;详情按需拉(git_commit_files / git_commit_message / git_commit_file_patch / git_branch_worktree_patch),sha 级进程内缓存。
- `BranchView.tsx`:menuActions 扩展;变基/合并/签出并变基走 GitConfirmDialog 二次确认(文案对齐 codemoss zh);成功/失败走现有 `run()` notice/error 条。
- `panelStore.ts`:`remoteDialogRequest` 信号;`GitPanel.tsx` 订阅打开 PushDialog。

菜单文案(硬编码中文,与面板一致):从 X 新建分支... / 签出并变基到 X / 与 X 比较 / 显示与工作树的差异 / 将 X 变基到 Y / 将 X 合并到 Y 中 / 重命名...;确认弹窗:「确认签出 {b} 并变基到 {c} 吗?」「确认将当前分支 {c} 变基到 {b} 吗?」「确认将 {b} 合并到当前分支吗?」。

## 验证

- Rust:新增集成测试(compare 双向唯一提交、worktree diff 状态/patch、rename 后 upstream 配置随迁、merge ff 与非 ff、rebase 快进语义、非法参数拒绝);`cargo test && cargo clippy --all-targets -- -D warnings && cargo fmt --check`。
- 前端:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`。
- UI:`pnpm tauri:dev` 真实窗口目检:本地/远程行菜单项与禁用态、从指定分支新建、重命名、合并、变基、双列对比弹窗、工作树差异 tab、推送开对话框。
