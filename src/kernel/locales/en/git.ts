/** en 词典 · git 域(键 = 中文源串,由文案迁移按归属写入;zh 恒等无词典)。 */
import { MESSAGES as PART2 } from "./git2";

export const MESSAGES = {
  /* 通用 */
  "关闭": "Close",
  "取消": "Cancel",
  "确定": "Confirm",
  "加载中…": "Loading…",
  "执行中…": "Working…",
  "(空消息)": "(no message)",
  "(无提交信息)": "(no commit message)",
  "未知": "Unknown",

  /* GitToolbar / 视图 */
  "差异": "Diff",
  "分支": "Branch",
  "历史": "History",
  "聚合增删行数(staged + 未暂存;多仓 = 选中仓口径)":
    "Aggregate insertions/deletions (staged + unstaged; multi-repo = selected repo)",
  "文件列表视图": "File list view",
  "平铺": "Flat",
  "树形": "Tree",

  /* GitPanel */
  "{op}成功。": "{op} succeeded.",
  "{op}失败:凭据需要交互,请到幕布终端执行 git {cmd}":
    "{op} failed: credentials require interaction. Run git {cmd} in the terminal.",
  "{op}失败。 {err} 可重试该操作。": "{op} failed. {err} You can retry this operation.",
  "当前目录不是 Git 仓库": "Current directory is not a Git repository",

  /* 多仓:引导 / 切换条 */
  "工作区根不是 Git 仓库": "Workspace root is not a Git repository",
  "扫描 {root}(深度 {depth})发现 {count} 个仓库。点击任一仓库,即以该仓为语境使用完整 Git 面板。":
    "Scanned {root} (depth {depth}) and found {count} repositories. Click any one to use the full Git panel in its context.",
  "{n} 个变更": "{n} changes",
  "进入 →": "Enter →",
  "同步说明:文件树着色照常工作(按各仓归属);幕布终端里的 git 命令不受影响;发现随切工作区":
    "Note: file tree coloring works as usual (per repository); git commands in the terminal are unaffected; discovery follows workspace switches",
  " 已截断,仅显示前 32 个。": " Truncated; showing the first 32 only.",
  "子模块": "Submodule",
  "工作树": "Worktree",
  "仓数已达发现上限({n}),仅显示前 {n} 仓":
    "Repository discovery limit reached ({n}); showing the first {n} only",
  "工作区内发现的 Git 仓库数": "Git repositories found in the workspace",
  "仓": "repos",
  "领先 {n} 个提交": "{n} commits ahead",
  "落后 {n} 个提交": "{n} commits behind",

  /* 远端操作条 / 还原横幅 */
  "刷新(重扫状态/分支/历史)": "Refresh (rescan status/branches/history)",
  "获取远端更新(fetch --all --prune,不动本地分支)":
    "Fetch remote updates (fetch --all --prune; local branches untouched)",
  "拉取远端更新(落后 {n} 个提交)": "Pull remote updates ({n} commits behind)",
  "拉取远端更新(对话框内可选远端与分支)":
    "Pull remote updates (choose remote and branch in the dialog)",
  "推送 {n} 个提交(对话框内可预览)": "Push {n} commits (preview available in the dialog)",
  "推送(对话框内查看预览与选项)": "Push (preview and options in the dialog)",
  "推送新分支并建立 upstream": "Push the new branch and set upstream",
  "存在冲突(可能来自「暂存并切换」,原分支 {branch})":
    'Conflicts present (possibly from "stash and switch"; original branch {branch})',
  "还原到切换前的 {branch}?": "Restore to pre-switch {branch}?",
  "当前分支上的冲突标记与携带改动将被丢弃(内容已在 stash 中,不会丢失),切回原分支并自动恢复改动。":
    "Conflict markers and carried-over changes on the current branch will be discarded (already stashed, nothing is lost); switches back to the original branch and restores the changes.",
  "还原": "Restore",
  "已还原到 {branch},改动已恢复": "Restored to {branch}; changes recovered",
  "还原到切换前": "Restore to pre-switch state",

  /* 分支行 / 右键菜单 */
  "点击检出为本地分支并建跟踪;右键更多操作":
    "Click to check out as a local branch with tracking; right-click for more actions",
  "上游:{upstream};右键更多操作": "Upstream: {upstream}; right-click for more actions",
  "右键更多操作": "Right-click for more actions",
  "(当前)": "(current)",
  "检出为本地分支并建跟踪": "Check out as a local branch with tracking",
  "再次点击强制删除(未合并)": "Click again to force delete (unmerged)",
  "删除;未合并时点两次后强制": "Delete; click twice to force when unmerged",
  "仅本地分支可用": "Local branches only",
  "未检测到当前分支": "No current branch detected",
  "当前分支不可用该操作": "Not available for the current branch",
  " → 本地": " → local",
  " → (无跟踪)": " → (no tracking)",
  " · 当前": " · current",
  "检出到本地": "Check out locally",
  "切换": "Switch",
  "已是当前分支": "Already the current branch",
  "从 {branch} 新建分支...": "New branch from {branch}...",
  "签出并变基到 {branch}": "Check out and rebase onto {branch}",
  "与 {branch} 比较": "Compare with {branch}",
  "显示与工作树的差异": "Show diff with working tree",
  "将 {current} 变基到 {branch}": "Rebase {current} onto {branch}",
  "将 {branch} 合并到 {current} 中": "Merge {branch} into {current}",
  "更新": "Update",
  "无 upstream,无法更新": "No upstream; cannot update",
  "跟随上游与 pull.rebase 配置": "Follows upstream and pull.rebase config",
  "仅 fast-forward 该分支引用,不切分支":
    "Only fast-forwards this branch ref; does not switch branches",
  "获取": "Fetch",
  "无 upstream": "No upstream",
  "只刷新远端引用,不动本地分支": "Only refreshes remote refs; local branches untouched",
  "推送...": "Push...",
  "仅当前分支可推送": "Only the current branch can be pushed",
  "打开推送对话框(可预览/选目标)": "Open the push dialog (preview and target selection)",
  "重命名...": "Rename...",
  "删除": "Delete",
  "不能删除当前分支": "Cannot delete the current branch",

  /* 分支视图(确认 / 通知 / 对话框) */
  "检出 {source} 为本地分支 {target}?": "Check out {source} as local branch {target}?",
  "切换到分支 {branch}?": "Switch to branch {branch}?",
  "工作区有未提交变动:「切换」会尝试直接携带(冲突将被拒绝);「暂存并切换」先入 stash、切换后自动恢复。":
    'The workspace has uncommitted changes: "Switch" tries to carry them over (rejected on conflict); "Stash and switch" stashes first and restores after switching.',
  "检出": "Check out",
  "已检出到本地分支 {branch}": "Checked out to local branch {branch}",
  "已切换到 {branch}": "Switched to {branch}",
  "暂存并检出": "Stash and check out",
  "暂存并切换": "Stash and switch",
  "已检出到本地分支 {branch}(改动已恢复)": "Checked out to local branch {branch} (changes restored)",
  "已切换到 {branch}(改动已恢复)": "Switched to {branch} (changes restored)",
  "新建分支": "New branch",
  "基于分支:": "Based on branch:",
  "新分支名": "New branch name",
  "新分支名...": "New branch name...",
  "创建": "Create",
  "已基于 {base} 创建 {name}": "Created {name} based on {base}",
  "签出并变基": "Check out and rebase",
  "确认签出 {branch} 并变基到 {onto} 吗?冲突时仓库留在变基中间态,可在幕布终端 continue/abort。":
    "Check out {branch} and rebase onto {onto}? On conflict the repository stays mid-rebase; continue/abort in the terminal.",
  "已签出 {branch} 并变基到 {onto}": "Checked out {branch} and rebased onto {onto}",
  "当前分支变基": "Rebase current branch",
  "确认将当前分支 {current} 变基到 {branch} 吗?冲突时仓库留在变基中间态,可在幕布终端 continue/abort。":
    "Rebase current branch {current} onto {branch}? On conflict the repository stays mid-rebase; continue/abort in the terminal.",
  "变基": "Rebase",
  "已将 {current} 变基到 {branch}": "Rebased {current} onto {branch}",
  "合并分支": "Merge branch",
  "确认将 {branch} 合并到当前分支吗?冲突时仓库留在合并中间态,可在幕布终端处理。":
    "Merge {branch} into the current branch? On conflict the repository stays mid-merge; resolve in the terminal.",
  "合并": "Merge",
  "已合并 {branch} 到 {current}": "Merged {branch} into {current}",
  "当前分支": "the current branch",
  "已更新 {branch}": "Updated {branch}",
  "已 fast-forward {branch}": "Fast-forwarded {branch}",
  "已获取 {branch} 的远端引用": "Fetched remote refs for {branch}",
  "重命名分支": "Rename branch",
  "原分支名:": "Current name:",
  "请输入新的分支名称": "Enter a new branch name",
  "重命名": "Rename",
  "已重命名 {from} 为 {to}": "Renamed {from} to {to}",
  "删除分支 {branch}?": "Delete branch {branch}?",
  "未合并到当前分支的删除会被拒绝;强行删除请用行内删除按钮连点两次。":
    "Deleting branches unmerged into the current branch is rejected; to force-delete, double-click the inline delete button.",
  "已删除 {branch}": "Deleted {branch}",
  "基于当前 HEAD 创建": "Create from current HEAD",
  "本地 ({n})": "Local ({n})",
  "远程 ({n})": "Remote ({n})",

  /* 历史视图 */
  "暂无提交历史": "No commit history yet",
  "传出的更改": "Outgoing changes",
  "传入的更改": "Incoming changes",
  "加载改动文件": "Loading changed files",
  "无改动文件": "No changed files",
  "已到最早提交": "Reached the earliest commit",

  /* 提交详情 / 工作树差异 */
  "个文件": "files",
  ...PART2,
} as Record<string, string>;
