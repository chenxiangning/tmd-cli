/** en 词典 · git 域下半(300 行铁则拆分,自 git.ts 移出;勿在两文件重复键)。 */
export const MESSAGES = {
  "该提交没有变更文件": "This commit has no changed files",
  "返回文件列表": "Back to file list",
  "二进制文件,无文本差异": "Binary file; no text diff",
  "无内容差异": "No content diff",
  "该文件在此提交中无差异": "This file has no diff in this commit",
  "选择文件查看差异": "Select a file to view its diff",
  "该文件相对 {branch} 无差异": "This file has no diff against {branch}",
  "文件({n})": "Files ({n})",
  "工作树与该分支没有差异": "No differences between the working tree and this branch",

  /* 分支对比弹窗 */
  "分支对比": "Branch compare",
  "工作树差异": "Working tree diff",
  "分支 {target} 与 {current} 差异": "Diff between branch {target} and {current}",
  "工作树 与 {branch} 差异": "Diff between working tree and {branch}",
  "比较基线: {target}, 目标分支: {current}": "Base: {target}, target branch: {current}",
  "基准分支: {branch}": "Base branch: {branch}",
  "独有提交 {n} 个": "{n} unique commits",
  "{branch} 独有": "Unique to {branch}",
  "选择提交查看详情": "Select a commit to view details",
  "收起": "Collapse",
  "展开": "Expand",
  "{n} 个提交": "{n} commits",
  "该方向无独有提交。": "No unique commits in this direction.",

  /* 差异视图 */
  "放弃 {path} 的工作区改动?": "Discard working tree changes of {path}?",
  "放弃 {n} 个文件的工作区改动?": "Discard working tree changes of {n} files?",
  "工作区还原到暂存区内容,不可恢复;staged 保留,untracked 不动。":
    "The working tree is reset to the index; this cannot be undone. Staged content is kept; untracked files untouched.",
  "放弃改动": "Discard changes",
  "工作区干净,无变更": "Working tree clean; no changes",
  "冲突文件:请到幕布终端解决后提交":
    "Conflicted file: resolve it in the terminal before committing",
  "{path}(点击在中间打开 diff)": "{path} (click to open diff in the center)",
  "放弃工作区改动(还原到暂存区;已暂存内容保留)":
    "Discard working tree changes (reset to index; staged content kept)",
  "冲突": "Conflict",

  /* 差异平铺列表 / 行 */
  "未暂存变更": "Unstaged changes",
  "未跟踪文件": "Untracked files",
  "待提交变更": "Staged changes",
  "git add 全部未暂存与未跟踪文件": "git add all unstaged and untracked files",
  "(全部暂存)": "(stage all)",
  "git reset 全部已暂存文件": "git reset all staged files",
  "(全部取消)": "(unstage all)",
  "已修改 (modified)": "Modified",
  "新增 (new file)": "New file",
  "已删除 (deleted)": "Deleted",
  "重命名 (renamed)": "Renamed",
  "类型变更 (typechange)": "Type change",
  "双方修改,冲突 (both modified)": "Conflict: both modified",
  "未跟踪 (untracked)": "Untracked",
  "{path} —— 点击在中间打开 diff": "{path} — click to open diff in the center",
  "{path} —— 点击在中间打开 diff · 冲突,请先到幕布解决":
    "{path} — click to open diff in the center · conflict; resolve in the terminal first",
  "取消暂存(git reset)": "Unstage (git reset)",
  "移出本次提交": "Exclude from this commit",
  "纳入本次提交": "Include in this commit",
  "(取消暂存)": "(unstage)",
  "暂存(git add)": "Stage (git add)",
  "(暂存)": "(stage)",
  "放弃工作区改动(还原到暂存区;不可恢复)":
    "Discard working tree changes (reset to index; irreversible)",
  "(放弃)": "(discard)",

  /* 提交 composer / 文件行动作 */
  "已提交 {sha}": "Committed {sha}",
  "提交信息…": "Commit message…",
  "附加 --amend:改动并入上一个提交": "Add --amend: fold changes into the previous commit",
  "提交(⌘⏎)": "Commit (⌘⏎)",
  "打开文件": "Open file",
  "打开文件位置": "Reveal in file manager",

  /* 远端对话框(共享骨架 / push / pull / fetch) */
  "当前仓库:{repoName}": "Current repository: {repoName}",
  "推送": "Push",
  "将提交推送到远端": "Push commits to remote",
  "推送标签": "Push tags",
  "运行 Git 挂钩": "Run Git hooks",
  "无可推送提交,已禁用推送按钮。": "No commits to push; the push button is disabled.",
  "推送历史": "Push history",
  "远端": "Remote",
  "目标远端分支": "Target remote branch",
  "拉取变更": "Pull changes",
  "拉取": "Pull",
  "修改选项": "Modify options",
  "获取远端更新": "Fetch remote updates",
  "仅更新远端引用元数据": "Only updates remote ref metadata",
  "更新远端引用信息用于比对。": "Updates remote ref information for comparison.",
  "将以默认作用域 all remotes 执行 fetch。": "Runs fetch with the default scope: all remotes.",
  "不会把变更合并到当前分支。": "Does not merge changes into the current branch.",
  "目标远端分支 toggle": "Target remote branch toggle",
  "该远端暂无可选分支,可手写输入。": "No branch candidates on this remote yet; type one manually.",
  "将推送到 {ref}。": "Will push to {ref}.",
  "用户名,逗号分隔": "Usernames, comma-separated",

  /* 推送预览双栏 */
  "本次推送提交": "Commits to push",
  "新分支首次推送": "First push to a new branch",
  "本地未找到目标引用 {ref},将按新分支首次推送处理:创建远端分支并推送当前分支提交。":
    "Target ref {ref} not found locally; this will be treated as a first push to a new branch: creates the remote branch and pushes the current branch's commits.",
  "仅展示最近 {n} 条提交。": "Showing the latest {n} commits only.",
  "选中提交详情": "Selected commit details",
  "请选择一条提交查看详情。": "Select a commit to view its details.",
  "变更文件": "Changed files",
  "正在加载推送预览提交...": "Loading push preview commits...",
  "正在加载提交详情...": "Loading commit details...",

  /* 拉取解释(Intent / Will Happen / Will NOT Happen) */
  "先从 {remote} 拉取 {targetBranch},再按当前仓库或用户的 Git 配置更新本地分支。":
    "First pulls {targetBranch} from {remote}, then updates the local branch following the repository or user Git config.",
  "先从 {remote} 拉取 {targetBranch},再把你本地新增的提交接到远端最新提交后面。":
    "First pulls {targetBranch} from {remote}, then replays your new local commits on top of the latest remote commits.",
  "先从 {remote} 拉取 {targetBranch};只有本地可以直接跟上远端时才更新。":
    "First pulls {targetBranch} from {remote}; updates only when the local branch can directly catch up with the remote.",
  "先从 {remote} 拉取 {targetBranch};如果 Git 最终采用 merge,就保留一个明确的合并提交。已有 rebase 配置仍可能优先生效。":
    "First pulls {targetBranch} from {remote}; if Git ends up merging, an explicit merge commit is kept. An existing rebase config may still take precedence.",
  "先从 {remote} 拉取 {targetBranch};如果 Git 最终采用 merge,就把远端变化汇总为一组待提交改动。已有 rebase 配置仍可能优先生效。":
    "First pulls {targetBranch} from {remote}; if Git ends up merging, remote changes are squashed into a set of pending changes. An existing rebase config may still take precedence.",
  "按 Git 配置执行": "Follows Git config",
  "你没有指定合并方式。Git 会读取当前分支、仓库或用户配置,因此不同仓库的结果可能不同。":
    "No merge method specified. Git reads the branch, repository, or user config, so results may differ across repositories.",
  "你本地新增的提交会重新接到远端最新提交后面,记录更整齐;遇到冲突会暂停,等你处理。":
    "Your new local commits are replayed on top of the latest remote commits for a cleaner history; it pauses on conflicts and waits for you to resolve them.",
  "本地没有独立新提交时才会拉取成功;如果本地和远端已经分叉,操作会停止,不会自动改写提交记录。":
    "Pull succeeds only when the local branch has no independent new commits; if local and remote have diverged, the operation stops without rewriting commit history.",
  "仅在 merge 模式下:即使可以直接更新,也会创建一个合并提交。这个选项本身不会强制 Git 放弃已有 rebase 配置。":
    "Merge mode only: creates a merge commit even when a direct update is possible. This option itself does not force Git to abandon an existing rebase config.",
  "仅在 merge 模式下:远端变化会汇总为一组待提交改动,需要你之后手动提交。这个选项本身不会强制 Git 采用 merge。":
    "Merge mode only: remote changes are squashed into a set of pending changes you commit manually later. This option itself does not force Git to use merge.",
  "只有 Git 最终需要创建合并提交时才会在提交前停下;如果只是直接更新分支,这个选项没有额外作用。":
    'Pauses before committing only when Git ends up creating a merge commit; if the branch is simply updated, this option has no extra effect.',
  "这个参数仍会出现在命令中,但 rebase 不创建合并提交,因此不会增加「提交前暂停」的效果。":
    'The flag still appears in the command, but rebase creates no merge commit, so it adds no "pause before commit" effect.',
  "直接更新分支不会创建合并提交,因此没有可暂停的提交,这个选项没有额外作用。":
    "Directly updating the branch creates no merge commit, so there is no commit to pause at; this option has no extra effect.",
  "如果 Git 最终采用 merge,会在创建合并提交前停下,供你检查并手动提交;如果已有配置选择 rebase,就没有合并提交可暂停。":
    "If Git ends up merging, it pauses before creating the merge commit for you to review and commit manually; if the config selects rebase, there is no merge commit to pause at.",
  "在 merge 模式下,--squash 本来就会留下待提交改动,所以这个参数不会再改变结果;走 rebase 时也不会增加合并前暂停。":
    "In merge mode, --squash already leaves pending changes, so this flag changes nothing; under rebase it adds no pre-merge pause either.",
  "如果 Git 最终创建合并提交,会跳过提交前自动检查(pre-merge-commit、commit-msg hooks);拉取和之后的手动提交不受影响。":
    "If Git ends up creating a merge commit, pre-commit checks are skipped (pre-merge-commit, commit-msg hooks); the pull itself and later manual commits are unaffected.",
  "这个参数仍会出现在命令中,但 rebase 不走合并提交检查,因此本次没有额外作用。":
    "The flag still appears in the command, but rebase does not run merge-commit checks, so it has no extra effect here.",
  "直接更新分支不会创建合并提交,也不会运行对应的提交前检查,因此这个选项没有额外作用。":
    "Directly updating the branch creates no merge commit and runs no corresponding pre-commit checks, so this option has no extra effect.",
  "如果 Git 最终创建合并提交,会跳过提交前自动检查,仓库规则可能因此被绕过;走 rebase 时不涉及这些合并检查。":
    "If Git ends up creating a merge commit, pre-commit checks are skipped and repository rules may be bypassed; under rebase these merge checks are not involved.",
  "在 merge + squash 模式下不会自动创建合并提交,因此没有对应检查可跳过;走 rebase 时这个参数也没有额外的合并检查效果。":
    "In merge + squash mode no merge commit is created automatically, so there is no corresponding check to skip; under rebase this flag adds no extra merge-check effect either.",
  "不会把本地提交推送到远端。你没有指定合并方式时,界面不会承诺 Git 最终会 merge、rebase 还是停止。":
    "Does not push local commits to the remote. With no merge method specified, the UI promises nothing about whether Git ends up merging, rebasing, or stopping.",
  "不会创建合并提交,也不会推送到远端;重新接到远端之后,本地提交的 commit hash 可能变化。":
    "Creates no merge commit and pushes nothing to the remote; after replaying onto the remote, local commit hashes may change.",
  "不会创建合并提交、不会 rebase、也不会推送到远端;分支已经分叉时不会自动整合。":
    "Creates no merge commit, performs no rebase, and pushes nothing to the remote; diverged branches are not integrated automatically.",
  "不会推送到远端。这个选项本身不保证关闭 rebase;当前 Git 配置仍可能让 rebase 生效。":
    "Does not push to the remote. This option itself does not guarantee rebase is off; the current Git config may still make rebase take effect.",
  "不会推送到远端。如果当前 Git 配置选择 rebase,界面不能保证最终会留下「一组待提交改动」。":
    'Does not push to the remote. If the current Git config selects rebase, the UI cannot guarantee a "set of pending changes" remains.',

  /* 中央 diff tab */
  "已暂存 → HEAD": "Staged → HEAD",
  "工作区 → 暂存区": "Working tree → index",
  "加载 diff…": "Loading diff…",
  "二进制文件,无文本 diff": "Binary file; no text diff",
  "无 diff 数据": "No diff data",
  "{n} 文件": "{n} files",
  "无 patch 数据": "No patch data",
  "选择左侧文件查看 diff": "Select a file on the left to view its diff",
  "{path} — 已暂存 diff": "{path} — staged diff",
  "{path} — 工作区 diff": "{path} — working tree diff",
  "diff 展示模式": "Diff view mode",
  "单栏": "Unified",
  "双栏": "Split",
  全文: "Full",
  全文查看: "View full file",

  /* 消费点在面板外的模块顶层数据(命令名 / 插件描述):词典先行,迁移待消费方 */
  "获取远端更新(fetch)": "Fetch remote updates (fetch)",
  "拉取远端(pull)": "Pull from remote (pull)",
  "推送远端(push)": "Push to remote (push)",
  "Git 状态与面板集成": "Git status and panel integration",
} as Record<string, string>;
