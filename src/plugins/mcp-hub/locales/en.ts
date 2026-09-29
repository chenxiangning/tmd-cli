/** en 词典 · mcp-hub 域(键 = 中文源串;zh 恒等无词典)。 */
export const MESSAGES_EN = {
  // ── 插件 meta ──
  "MCP 管理": "MCP Manager",
  "跨引擎 MCP 配置写回管理:增删改直写各家配置文件,附三源商店与导入桥":
    "Cross-engine MCP config management: edits write directly to each CLI's config, with 3-source store and import bridge",

  "MCP · {n} 台引擎 · {m} 个服务器": "MCP · {n} engines · {m} servers",
  "点击管理该引擎": "Click to manage this engine",
  "读取失败": "Read failed",
  "尚未创建": "Not created yet",
  "正在扫描…": "Scanning…",
  "没有可管理的引擎": "No manageable engines",
  "pi:—(靠 pi-mcp-adapter 扩展)": "pi: — (via pi-mcp-adapter extension)",
  "打开管理": "Open manager",

  // ── 中央 tab 壳 ──
  "引擎": "Engines",
  "服务器": "Servers",
  "商店": "Store",
  "导入": "Import",

  // ── 服务器视图 ──
  "配置文件读取/解析失败,已停止编辑以防覆写": "Config file read/parse failed; editing blocked to prevent overwrite",
  "查看原始文件": "View raw file",
  "· 尚未创建,首次保存即建": "· not created; first save creates it",
  "收起原文": "Collapse raw",
  "原始文件": "Raw file",
  "新增 server": "New server",
  "暂无 server;新增一台或从商店/导入页安装": "No servers; add one or install from Store/Import",
  "配置文件尚未创建;新增第一台即创建": "Config not created; adding the first server creates it",
  "连通测试(一次性握手,不改配置)": "Connectivity test (one-shot handshake, no config change)",
  "编辑": "Edit",
  "删除": "Delete",
  "测试中…": "Testing…",
  "通了 · {n} 个工具 · {ms}ms": "OK · {n} tools · {ms}ms",
  "删除 {engine} 的 server「{name}」?(各家方言:删除即卸载)": "Delete server \"{name}\" from {engine}? (per-dialect: removal = uninstall)",

  // ── 编辑弹窗 ──
  "新增 server · {engine}": "New server · {engine}",
  "编辑 {name} · {engine}": "Edit {name} · {engine}",
  "已保存,下次会话生效(不承诺即时生效)": "Saved; takes effect next session (no immediacy promised)",
  "保存": "Save",
  "名称(同文件内唯一)": "Name (unique in file)",
  "同名 server 已存在": "A server with this name already exists",
  "transport(三选互斥)": "Transport (mutually exclusive)",
  "command(必填)": "command (required)",
  "cwd(可选)": "cwd (optional)",
  "args(每行一条)": "args (one per line)",
  "url(必填)": "url (required)",
  "env(值默认掩码,眼睛显明文)": "env (values masked; eye to reveal)",
  "headers(值默认掩码,眼睛显明文)": "headers (values masked; eye to reveal)",
  "加一行 {label}": "Add {label} row",
  "移除此行": "Remove this row",

  // ── 原始文件预览 ──
  "原始文件(只读)": "Raw file (read-only)",
  "在文件 tab 打开": "Open in file tab",
  "关闭": "Close",
  "文件不存在或不可读": "File missing or unreadable",
  "读取中…": "Reading…",

  // ── 商店 ──
  "搜索 MCP 服务器": "Search MCP servers",
  "搜索后回车": "Search, then Enter",
  "清缓存重拉": "Clear cache and refetch",
  "刷新": "Refresh",
  "该源不可达或暂不可用(Glama 现需 API key)": "Source unreachable or unavailable (Glama now requires an API key)",
  "加载中…": "Loading…",
  "无结果;换个关键词试试": "No results; try another keyword",
  "加载更多": "Load more",
  "{n} 个工具": "{n} tools",
  "安装": "Install",
  "打开安装草稿(填空后写入目标引擎)": "Open install draft (fill in, then write to target engine)",
  "此卡片需手动配置(无可生成草稿)": "This card needs manual setup (no generated draft)",

  // ── 安装草稿弹窗 ──
  "安装 {name}": "Install {name}",
  "正在拉取安装详情…": "Fetching install details…",
  "此卡片无可生成的安装草稿(需手动配置)": "No install draft available for this card (manual setup needed)",
  "远程直连": "Remote direct",
  "本地 stdio": "Local stdio",
  "命令来自 registry 包指引,请确认后再写入": "Command comes from the registry package hint; confirm before writing",
  "server 名称(同文件内唯一)": "Server name (unique in file)",
  "同名 server 已存在,请改名或先删除旧条目": "A server with this name exists — rename or remove the old entry first",
  "目标引擎": "Target engine",
  "模板填空(必填项完成后可写入)": "Template inputs (required ones must be filled)",
  "落位预览(将写入的 server 形状)": "Placement preview (server shape to be written)",
  "写入目标引擎": "Write to target engine",

  // ── 导入 ──
  "导入到目标引擎": "Import into target engine",
  "重新扫描": "Rescan",
  "手选文件": "Pick a file…",
  "选择 MCP 配置文件(JSON 或 TOML)": "Choose an MCP config file (JSON or TOML)",
  "所选文件没有可识别的 MCP server(JSON mcpServers 或 TOML [mcp_servers.*])":
    "No recognizable MCP servers in the file (JSON mcpServers or TOML [mcp_servers.*])",
  "本机没有扫到其他工具的 MCP 配置(claude.json / Claude Desktop / codex / codebuddy 等)":
    "No other tools' MCP configs found (claude.json / Claude Desktop / codex / codebuddy etc.)",
  "目标已有同 id(勾选 = 覆盖)": "Target already has this id (check = overwrite)",
  "已勾选 {n} 台": "{n} selected",
  "导入 {n} 台": "Import {n}",
  "写入中…": "Writing…",
  "导入完成:{done} 台写入,{failed} 台失败": "Import done: {done} written, {failed} failed",
  "已达 20000 字符预览上限,完整内容请用「在文件 tab 打开」":
    "Preview capped at 20,000 chars — use \"Open in file tab\" for the full content",
};
