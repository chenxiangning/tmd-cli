/** en 词典 · session-board 域(键 = 中文源串;zh 恒等无词典)。 */
export const MESSAGES_EN = {
  // ── BoardTab 工具栏/月历 ──
  "暂无工作区": "No workspace",
  "正在扫描会话…": "Scanning sessions…",
  "工作区": "Workspace",
  "全部工作区": "All workspaces",
  "上个月": "Previous month",
  "下个月": "Next month",
  "今天": "Today",
  "引擎过滤": "Engine filter",
  "状态过滤": "Status filter",
  "{n} 个会话": "{n} sessions",
  "{n} 个未查看": "{n} unviewed",
  "未查看 = 结束未归档且 14 天内有活动": "Unviewed = ended, unarchived, active within 14 days",
  "重新扫描": "Rescan",
  "有未查看会话": "Has unviewed sessions",

  // ── 生命周期五态(boardData BOARD_STATES;侧栏已有「运行时/空闲」,此处看板口径) ──
  "运行中": "Running",
  "待运行": "Waiting",
  "结束-未查看": "Ended · unviewed",
  "结束-已查看": "Ended · viewed",
  "已归档": "Archived",

  // ── DayPanel ──
  "小时分布": "Hourly distribution",
  "收起日视图": "Collapse day view",
  "已查看 → 默认自动进入已归档": "Viewed → auto-archive by default",
  "已查看 → 自动归档": "Viewed → auto-archive",
  "查看未查看会话后自动归档;归档可逆,已归档卡悬停可恢复":
    "Viewing an unviewed session auto-archives it; archiving is reversible via restore on the card",
  "查看未查看会话后自动归档;关闭自动归档的设置属未来扩展":
    "Viewing an unviewed session auto-archives it; a setting to disable this is a future extension",
  "当日无会话": "No sessions on this day",
  "运行时": "Running",

  // ── SwimTimeline 卡片动作 ──
  "重命名": "Rename",
  "恢复(取消归档)": "Restore (unarchive)",

  "远程工作区暂不支持看板(仅本机磁盘)": "Board unavailable for remote workspaces (local disk only)",
  "已重命名:{title}": "Renamed: {title}",
  "少": "Low",
  "多": "High",
  "底点 = 主引擎": "dots = top engines",
  "点击折叠/展开本列(跨日保持)": "Click to collapse/expand this lane (persists across days)",
  "会话看板": "Session board",
} as Record<string, string>;
