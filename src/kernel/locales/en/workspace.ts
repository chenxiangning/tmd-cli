/** en 词典 · workspace 域(键 = 中文源串,由文案迁移按归属写入;zh 恒等无词典)。 */
export const MESSAGES = {
  // ── WorkspaceSection caption & view toggle ──
  "工作区": "Workspaces",
  "会话视图": "Session view",
  "默认": "Default",
  "归档": "Archive",
  "展开全部工作区会话": "Expand all workspace sessions",
  "折叠全部工作区会话": "Collapse all workspace sessions",
  "添加工作区": "Add workspace",
  "选择工作区目录": "Choose workspace directory",
  "左侧栏工作区/会话列表与菜单": "Sidebar workspace / session list and menus",
  "打开新建会话菜单": "Open new session menu",

  // ── WorkspaceCard ──
  "展开会话列表": "Expand session list",
  "折叠会话列表": "Collapse session list",
  "刷新会话": "Refresh sessions",
  "新建会话": "New session",

  // ── PinnedSessions (已置顶) ──
  "已置顶": "Pinned",
  "展开已置顶": "Expand pinned",
  "收起已置顶": "Collapse pinned",
  "{workspace} · {profile} 会话 {id}": "{workspace} · {profile} session {id}",

  // ── RunningZone ──
  "运行区": "Running zone",
  "展开运行区": "Expand running zone",
  "收起运行区": "Collapse running zone",

  // ── SessionGroups (CLI / Shell / SSH) ──
  "终端": "Terminal",
  "结束终端会话「{title}」?": "End terminal session \"{title}\"?",
  "断开 SSH 会话「{title}」?": "Disconnect SSH session \"{title}\"?",

  // ── WorkspaceCard 行动作组 ──
  "会话管理": "Session management",

  // ── SessionRows · DiskSessionRow / PinToggle ──
  "归": "A",
  "恢复 {profile} 会话 {id}": "Restore {profile} session {id}",
  "取消置顶": "Unpin",
  "置顶到全局": "Pin to global",
  "置顶到全局(右键可置顶到工作区内)":
    "Pin to global (right-click to pin to workspace)",
  "会话尚未落盘,暂不可置顶": "Session not yet persisted; cannot pin",
  "会话尚未落盘,暂不可命名": "Session not yet persisted; cannot rename",
  "会话尚未落盘,暂不可归档": "Session not yet persisted; cannot archive",

  // ── SessionStatusLabel 三态 ──
  "运行时": "Running",
  "会话结束-未查看": "Turn ended · unread",
  "会话结束-已查看": "Turn ended · viewed",

  // ── LiveSessionRow / PinnedSessions / RunningZone badge ──
  "等待确认": "Awaiting confirmation",

  // ── SessionContextMenu ──
  "复制 Session ID": "Copy session ID",
  "重命名": "Rename",
  "置顶到工作区内": "Pin to workspace",
  "删除会话": "Delete session",
  "确认删除?": "Confirm delete?",

  // ── SessionMenu (新建会话下拉) ──
  "刷新 {profile} 会话列表": "Refresh {profile} session list",
  "工作区操作": "Workspace actions",
  "删除工作区": "Delete workspace",
  "设置别名": "Set alias",
  "别名(留空清除)": "Alias (leave empty to clear)",

  // ── SessionManage (管理模式批量条 / 行按钮) ──
  "更多... (还有 {n} 条)": "More... ({n} remaining)",
  "已选 {n}": "{n} selected",
  "恢复到默认视图": "Restore to default view",
  "归档(默认视图隐藏)": "Archive (hidden in default view)",
  "删除会话(物理删除)": "Delete session (permanent)",
  "删除选中会话(物理删除)": "Delete selected sessions (permanent)",
  "再击确认物理删除": "Click again to confirm permanent deletion",
  "删除": "Delete",
  "恢复": "Restore",
  "确认": "Confirm",

  // ── 工作区分组(groups / 侧栏组头 / SessionMenu 移动到组 / GroupSettingsTab) ──
  "工作区分组": "Workspace groups",
  "组织左侧栏工作区的分组:新建、重命名、排序与删除。":
    "Groups that organize workspaces in the left sidebar: create, rename, reorder, delete.",
  "分组管理": "Group management",
  "移动到组": "Move to group",
  "未分组": "Ungrouped",
  "组名过长(上限 60 字)": "Group name too long (max 60 chars)",
  "组名不能为空": "Group name is required",
  "「未分组」是保留名,不能用作组名": "\"Ungrouped\" is a reserved name and cannot be used",
  "组名已存在": "Group name already exists",
  "新建分组": "New group",
  "分组用于组织左侧栏的工作区;「未分组」是保留名。删除组后,组内工作区自动落回未分组。":
    "Groups organize workspaces in the left sidebar; \"Ungrouped\" is a reserved name. Deleting a group moves its workspaces back to Ungrouped.",
  "组名": "Group name",
  "新建": "Create",
  "上移": "Move up",
  "下移": "Move down",
  "删除组": "Delete group",
  "删除组「{name}」?组内工作区将移到未分组。":
    "Delete group \"{name}\"? Its workspaces will move to Ungrouped.",
} as Record<string, string>;
