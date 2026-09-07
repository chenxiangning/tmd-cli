/** en 词典 · welcome 域(键 = 中文源串,由文案迁移按归属写入;zh 恒等无词典)。 */
export const MESSAGES = {
  /* 欢迎页 */
  "多 CLI 桌面客户端 —— 已就绪 {ready} / {total} 个引擎":
    "Multi-CLI desktop client — {ready} / {total} engines ready",
  "GitHub 仓库": "GitHub repository",
  "近期会话": "Recent sessions",

  /* 引擎卡 */
  "官方文档": "Docs",
  "探针中…": "Probing…",
  "已安装": "Installed",
  "未安装": "Not installed",
  "探针失败": "Probe failed",
  "已是最新": "Up to date",
  "最新版本 {version}": "Latest version {version}",
  "最新版本 {version},点\"更新\"升级":
    "Latest version {version} — click \"Update\" to upgrade",
  "更新": "Update",
  "更新到 {version}": "Update to {version}",
  "重新安装/更新到最新版": "Reinstall/update to latest",
  "重新探针": "Re-probe",
  "安装": "Install",
  "先安装 {name}": "Install {name} first",

  /* 前置依赖引导 */
  "探针前置依赖 {name}…": "Probing prerequisite {name}…",
  "前置依赖 {name} 探针失败": "Prerequisite {name} probe failed",
  "依赖 {name} 运行时 —— 先安装 {name},再安装/更新本引擎":
    "Requires the {name} runtime — install {name} first, then install/update this engine",
  "{name} 官网": "{name} website",
  "{name} 安装": "{name} install",
  "正在安装 {name}…": "Installing {name}…",
  "安装 {name}": "Install {name}",
  "重新探针前置依赖": "Re-probe prerequisite",

  /* 安装日志 */
  "{label}完成": "{label} complete",
  "{label}失败,日志见上方": "{label} failed — see log above",

  /* 凭据/额度区 */
  "已登录": "Signed in",
  "已登录(ChatGPT 订阅)": "Signed in (ChatGPT plan)",
  "已登录;官方订阅额度请在 CLI 内 /usage 查看":
    "Signed in; check plan usage with /usage in the CLI",
  "凭据缺失": "Credential missing",
  "暂不支持该供应商": "Provider not supported yet",
  "{label}窗口 · 已使用 {pct}%": "{label} window · {pct}% used",
  "{base} · 重置于 {at}({relative})": "{base} · resets {at} ({relative})",
  "重置{time} · {relative}": "Resets {time} · {relative}",
  "{m}月{d}日": "{m}/{d}",

  /* 插件 meta(渲染点在市场清单/命令抽屉,主会话包裹) */
  "欢迎页": "Welcome page",
  "无会话首页:引擎卡片、凭据、最近会话":
    "No-session home: engine cards, credentials, recent sessions",
} as Record<string, string>;
