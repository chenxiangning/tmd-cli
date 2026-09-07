/** en 词典 · common 域(键 = 中文源串,由文案迁移按归属写入;zh 恒等无词典)。 */
export const MESSAGES = {
  // ── TopBar / 窗口控件 ──
  "窗口控制": "Window controls",
  "最小化": "Minimize",
  "最大化": "Maximize",
  "关闭": "Close",
  "插件市场": "Plugin market",
  "回到首页": "Go to home",
  "收起左栏": "Collapse left panel",
  "展开左栏": "Expand left panel",
  "收起右栏": "Collapse right panel",
  "展开右栏": "Expand right panel",

  // ── 右栏面板 toolbar ──
  "右侧面板": "Right panels",
  "更多面板": "More panels",
  "钉到工具条": "Pin to toolbar",
  "新建文件": "New file",
  "新建文件夹": "New folder",
  "刷新文件树": "Refresh file tree",

  // ── 会话 tab 条 ──
  "打开的会话": "Open sessions",
  "{title} · 等待确认": "{title} · awaiting confirmation",
  "从标签条移除:{title}": "Remove {title} from the tab bar",
  "从标签条移除(会话保持运行)": "Remove from tab bar (session keeps running)",

  // ── 编辑 tab 条 ──
  "还原": "Restore",
  "最大化查看": "Maximize view",
  "最大化查看 {file}": "Maximize view of {file}",
  "关闭 {file}": "Close {file}",
  "打开的文件": "Open files",

  // ── 左下角设置簇 ──
  "最多钉住 {n} 个": "Pin up to {n} items",
  "钉到底栏": "Pin to bottom bar",
  "取消钉住": "Unpin",
  "设置菜单": "Settings menu",
  "设置": "Settings",
  "版本与更新": "Version and updates",

  // ── 版本弹窗 ──
  "点击「检查更新」查询 GitHub 最新发布版本。":
    "Click \"Check for updates\" to query the latest GitHub release.",
  "正在检查更新…": "Checking for updates…",
  "已是最新版本。": "You're on the latest version.",
  "检查中…": "Checking…",
  "检查更新": "Check for updates",
  "前往下载": "Go to download",
  "发现新版本": "New version found",
  "更新记录": "Changelog",
  "上一版本": "Previous version",
  "下一版本": "Next version",
  "当前": "Current",
  "查看 GitHub Releases": "View GitHub Releases",

  // ── 插件市场 ──
  "CLI 引擎": "CLI engines",
  "界面功能": "UI features",
  "核心系统": "Core system",
  "{label} · {n} 位": "{label} · {n} slots",
  "核心插件 · 已焊死,不可拔出": "Core plugin · welded in, cannot be unplugged",
  "点击拔出 {id}": "Click to unplug {id}",
  "点击插入 {id}": "Click to plug in {id}",
  "核心插件": "Core plugin",
  " · 待重启": " · restart pending",
  "客户端 · 插排本体": "Client · the power strip",
  "总电源常开": "Main power always on",
  "{on}/{total} 已插入": "{on}/{total} plugged in",
  "核心 · 焊死": "Core · welded",
  "重启后生效": "Takes effect after restart",
  "常插": "Always on",
  "拔出": "Unplug",
  "插入": "Plug in",
  "客户端是插排,插件是插头 —— 插上即用,拔掉即停":
    "The client is a power strip and plugins are plugs — plug in to use, unplug to stop",
  "视图切换": "Switch view",
  "插排视图": "Strip view",
  "列表视图": "List view",
  "{n} 个插拔变更待重启生效": "{n} plug changes pending restart",
  "重启应用": "Restart app",
  "关闭插件市场": "Close plugin market",
  "已插入(运行中)": "Plugged in (running)",
  "已拔出(重启后生效)": "Unplugged (takes effect after restart)",
  "焊死的核心插件不可拔": "Welded core plugins cannot be unplugged",
  "点击插头即可插拔": "Click a plug to plug or unplug",
  "在线市场": "Online market",
  "远程插件市场 · 建设中": "Remote plugin market · in development",
  "未来可在此浏览、安装社区插件包 —— 新插头直接快递到你的插排":
    "Browse and install community plugin packs here in the future — new plugs delivered straight to your strip",
  "即将上线": "Coming soon",
  "已拔出 {id} —— 重启后从插排断电": "Unplugged {id} — powered off from the strip after restart",
  "已插入 {id} —— 重启后生效": "Plugged in {id} — takes effect after restart",

  // ── 会话启动失败通知 ──
  "{name} 会话启动失败": "{name} session failed to start",
  "关闭启动失败通知": "Dismiss startup failure notice",

  // ── tab 右键菜单 ──
  "重命名": "Rename",
  "会话尚未落盘,暂不可命名": "Session not yet persisted; cannot rename",
  "关闭其他 tab": "Close other tabs",
  "关闭全部 tab": "Close all tabs",

  // ── 编辑区空态 ──
  "选中一个文件查看": "Select a file to view",

  // ── 更新检查错误 ──
  "当前为浏览器 dev 环境(无 Tauri runtime),无法发起检查;请在应用窗口内使用。":
    "Browser dev environment (no Tauri runtime); checking is unavailable. Use the app window.",
  "更新源返回 HTTP {status},请稍后重试。":
    "Update source returned HTTP {status}; try again later.",
  "更新源响应格式异常,未解析到发布版本。":
    "Unexpected response from the update source; no release parsed.",
  "网络请求失败:{reason}。若网络需代理,请先在设置菜单「网络代理」中开启后重试。":
    "Network request failed: {reason}. If your network needs a proxy, enable \"Network proxy\" in the settings menu and retry.",

  // ── 入口 ──
  "插件激活失败：{error}": "Plugin activation failed: {error}",

  // ── 重命名输入 ──
  "会话名称(留空清除命名)": "Session name (empty to clear)",

  // ── 终端搜索 ──
  "终端搜索": "Terminal search",
  "搜索终端输出": "Search terminal output",
  "上一个 (Shift+Enter)": "Previous (Shift+Enter)",
  "下一个 (Enter)": "Next (Enter)",
  "关闭 (Esc)": "Close (Esc)",

  // ── 外壳命令标题(定义处保留中文,设置页快捷键清单渲染点包 t)──
  "折叠/展开左栏": "Toggle left panel",
  "折叠/展开右栏": "Toggle right panel",
  "打开设置": "Open settings",
  "关闭标签页": "Close tab",
  "切换到第 N 个会话": "Switch to session N",
  "切换到面板 1": "Switch to panel 1",
  "切换到面板 2": "Switch to panel 2",
  "切换到面板 3": "Switch to panel 3",
  "下一个标签页": "Next tab",
  "上一个标签页": "Previous tab",
  "最大化/还原编辑区": "Maximize/restore editor",
  "在左侧栏定位会话": "Locate session in sidebar",
  "刷新当前面板": "Refresh current panel",
} as Record<string, string>;
