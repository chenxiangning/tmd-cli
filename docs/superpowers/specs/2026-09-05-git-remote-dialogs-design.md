# Git 远端操作对话框复刻(codemoss push/pull/fetch)+ 顶栏聚合数字迁移

- 日期:2026-09-05
- 状态:已落地(前端五件套 + Rust 三件套全绿;tauri:dev 窗口已验证可启动)

## 背景与目标

现状:Git 面板聚合行的 fetch/pull/push 三按钮点击即执行,无预览、无选项;聚合 ±行数与文件数挤在分支行;三按钮用通用箭头图标(Download/ArrowDown/ArrowUp),语义不清。

目标(对齐 codemoss 同类能力,UI 文案逐字复刻):

1. 聚合行 `+N / -N M 文件` 上移到顶栏「差异 Diff」行(GitToolbar);分支行只留 `分支 → upstream` + 三个远端按钮。
2. 三个远端按钮换语义图标:fetch = CloudDownload、pull = Download、push = Upload(与 BranchContextMenu 及 codemoss 对话框标题图标一致)。
3. 三按钮改为打开对话框:
   - **推送**:hero tokens(`<branch> -> <remote>:<target>` + New 徽标)、本次推送提交列表 / 选中提交详情(变更文件树 + numstat)双栏、远端 picker、目标远端分支 combobox、Push to Gerrit(topic/reviewers/cc)、推送历史(会话内存,上限 3)、推送标签 / 运行 Git 挂钩(默认勾)/ Force with lease、取消/推送。
   - **拉取**:hero(远端 -> 目标分支 + 命令预览)、远端 / 目标远端分支两下拉、修改选项展开器(--rebase/--ff-only/--no-ff/--squash 单选互斥 + --no-commit/--no-verify 独立开关,可移除 chips)、Intent / Will Happen / Will NOT Happen 动态解释、Example、取消/拉取。
   - **获取**:hero(fetch -> all remotes,仅更新远端引用元数据)、Intent / Will Happen / Will NOT Happen、Example、取消/获取。

## 方案取舍

- **后端继续 shell-out git CLI**(沿用 remote_ops.rs 凭据链/超时/管道排空纪律),不引入 git2 网络层:push 加 `--no-verify` / `--force-with-lease` / `--follow-tags` / `<remote> HEAD:<branch>`(Gerrit = `HEAD:refs/for/<b>[%topic=…,r=…,cc=…]`),pull 按序 `[strategy] [--no-commit] [--no-verify] [remote [branch]]`,fetch `--all --prune` 或 `<remote>`。选项拼装语义与 codemoss 逐一对应。
- **推送预览用 git2 revwalk**(push HEAD,hide `refs/remotes/<remote>/<branch>`,TIME|TOPOLOGICAL,默认 limit 120 + hasMore),复用 log.rs LogEntry;commit 详情复用现有 `git_commit_files`(自带 numstat/binary),文件点击开中央 `git-commit-diff` tab(幕布外增强,替代 codemoss 的模态 diff)。
- **新分支首次推送可确认**:codemoss 对目标引用缺失时禁用推送;此处保留「New」徽标与提示文案,但允许确认(执行 push -u 建跟踪)——否则相对现状是功能回退。
- **fetch 保留 --prune** 并如实显示在 Example(`git fetch --all --prune`),不逐字照抄 codemoss 的 `git fetch --all`:删除的远端分支引用需要清理,这是现状语义。
- **推送历史不落盘**:codemoss 持久化到 client store;tmd-cli 无对应设施,改会话内存(模块级 Map<cwd, entries[]>,上限 3),避免为便利功能新增持久层。
- **pull 按钮不再因无 upstream 禁用**:对话框可显式选任意 `远端/分支` 合并进当前分支(`git pull origin main` 在 feature 分支上合法),禁用反而收窄能力;detached HEAD 仍不参与。
- **聚合数字共享**:GitToolbar 与 GitPanel 是两个组件实例,totals 重操作不双拉 —— panelStore 增加只读镜像,useGitTotals 写入,GitToolbar 消费。

## 验证

- `cargo test && cargo clippy --all-targets -- -D warnings && cargo fmt --check`(src-tauri)
- `pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`
- `pnpm tauri:dev` 目检:三对话框打开/预览/选项/解释文案随选项变化/执行后通知与刷新;顶栏数字与分支行图标。
