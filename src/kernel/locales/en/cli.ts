/** en 词典 · cli 域(键 = 中文源串;zh 恒等无词典)。
 *  已知债务:provider/凭据/市场词条(omp agent.db、kimi-code、minimax、codex oauth
 *  等)是各 cli-* 插件私有知识,待经 i18n.registerMessages 随插件迁出(kernel 不收纳
 *  单插件词条);新词条一律进插件词典,勿再加于此。
 */
export const MESSAGES = {
  /* omp 扩展市场面板 */
  "omp 扩展": "omp extensions",
  "omp 扩展市场": "omp extension market",
  "刷新": "Refresh",
  "关闭": "Close",
  "检测 omp…": "Detecting omp…",
  "未检测到 omp CLI —— 到「欢迎页」引擎卡先安装 omp,再回来管理扩展":
    "omp CLI not detected — install omp from the Welcome page engine card first, then come back to manage extensions",
  "实时目录拉取失败,展示离线精选目录":
    "Live catalog fetch failed; showing offline picks",
  "已安装({n})": "Installed ({n})",
  "无法解析已装清单:{error}": "Cannot parse installed list: {error}",
  "读取已装清单…": "Reading installed list…",
  "还没有安装任何扩展": "No extensions installed yet",
  "热门扩展": "Featured extensions",
  "(离线精选)": "(offline picks)",
  "加载目录…": "Loading catalog…",
  "扩展以当前用户权限在 omp 进程内执行任意代码;装卸/启停即时改磁盘,已开的 omp 会话不热加载,重开会话生效。":
    "Extensions run arbitrary code inside the omp process under your current user permissions; install/uninstall/enable/disable write to disk immediately — open omp sessions don't hot-reload, restart the session to apply.",
  "该插件将以你的用户权限在 omp 进程内执行任意代码(tmd-cli 不做任何沙箱隔离),安装前请务必审查来源;新装插件对已开的会话不生效,需重开会话。":
    "This plugin will run arbitrary code inside the omp process under your user permissions (tmd-cli applies no sandboxing) — always review the source before installing. Newly installed plugins don't affect open sessions; restart the session to apply.",

  /* 目录卡/已装行 */
  "{n}万": "{n}×10k",
  "{n}/周": "{n}/wk",
  "精选": "Curated",
  "暂无描述": "No description",
  "获取描述…": "Fetching description…",
  "展开详情": "Show details",
  "收起详情": "Hide details",
  "任意代码执行": "Arbitrary code execution",
  "omp 插件在你的用户权限下进程内执行任意代码":
    "omp plugins run arbitrary code in-process under your user permissions",
  "来源": "Source",
  "安装中": "Installing…",
  "卸载中": "Uninstalling…",
  "启用": "Enable",
  "停用": "Disable",
  "启用中": "Enabling…",
  "停用中": "Disabling…",
  "卸载": "Uninstall",
  "确认安装": "Confirm install",
  "确认卸载": "Confirm uninstall",
  "取消": "Cancel",
  "—— 完成。已开会的会话不热加载,重开会话生效 ——":
    "—— Done. Open sessions don't hot-reload; restart the session to apply ——",
  "—— 失败:命令非零退出,详见上方日志 ——":
    "—— Failed: command exited non-zero, see log above ——",
  "—— 已卸载 ——": "—— Uninstalled ——",
  "—— 失败:{error} ——": "—— Failed: {error} ——",

  /* 配额:引擎 provider 报错 */
  "未识别当前模型,无法路由供应商":
    "Current model not recognized; cannot route to a provider",
  "omp 供应商 {vendor} 暂不支持额度查询":
    "omp provider {vendor} is not supported for quota queries yet",
  "omp 未登录供应商 {vendor} (~/.omp/agent/agent.db)":
    "omp is not signed in to provider {vendor} (~/.omp/agent/agent.db)",
  "Anthropic 官方订阅暂无公开额度 API,请在 claude /usage 查看":
    "No public quota API for Anthropic plans; check claude /usage",
  "未找到 claude 凭据 (~/.claude/settings.json env)":
    "No claude credentials found (~/.claude/settings.json env)",
  "codex 自定义供应商(阿里云百炼)无公开额度 API,请在控制台查看":
    "codex custom provider (Alibaba Bailian) has no public quota API; check the console",
  "codex 为官方 API key 模式,OpenAI 无套餐额度查询接口":
    "codex is in official API key mode; OpenAI has no plan-quota endpoint",
  "未找到 codex 登录态 (~/.codex/auth.json)":
    "No codex login found (~/.codex/auth.json)",
  "未找到 grok 凭据 (~/.grok/config.toml [model] api_key);官方 OAuth 登录暂无公开额度 API,请在 CLI 内查看":
    "No grok credentials found (~/.grok/config.toml [model] api_key); official OAuth login has no public quota API — check in the CLI",
  "本机 codex 会话暂无额度快照(至少完成一轮对话后可见)":
    "No local codex quota snapshot yet (visible after at least one completed turn)",
  "opencode 数据目录不可用": "opencode data directory unavailable",

  /* 配额:供应商公共层 */
  "缺少 kimi 凭据": "Missing kimi credentials",
  "缺少 minimax API key": "Missing minimax API key",
  "缺少智谱 API key": "Missing Zhipu API key",
  "缺少 deepseek API key": "Missing deepseek API key",
  "缺少 openai-codex oauth 凭据 (access/accountId)":
    "Missing openai-codex OAuth credentials (access/accountId)",
  "缺少中转站 API key": "Missing relay API key",
  "中转站查询需要 base_url": "Relay quota query requires base_url",
  "该供应商(阿里云百炼 Coding Plan)无公开额度 API,请在控制台查看":
    "This provider (Alibaba Bailian Coding Plan) has no public quota API; check the console",
  "MiniMax API 错误 (code {code}): {msg}": "MiniMax API error (code {code}): {msg}",
  "智谱 API 错误: {msg}": "Zhipu API error: {msg}",
  "智谱响应缺 data 字段": "Zhipu response missing data field",
  "未知": "unknown",
  "base_url 不是合法 http(s) URL: {url}":
    "base_url is not a valid http(s) URL: {url}",
  "鉴权失败 (HTTP {status})": "Authentication failed (HTTP {status})",
  "鉴权失败 (Sub2API)": "Authentication failed (Sub2API)",
  "鉴权失败 (New API)": "Authentication failed (New API)",
  "Sub2API 响应无额度数据": "Sub2API response has no quota data",
  "Sub2API 响应格式不支持 (code={code})":
    "Unsupported Sub2API response format (code={code})",
  "New API 响应无额度数据": "New API response has no quota data",
  "快照 {time}": "snapshot {time}",
  "omp plugin list 缺少 npm 数组": "omp plugin list is missing the npm array",

  /* 配额数据(QuotaChip/凭据区渲染点包裹,主会话迁移) */
  "已使用": "Used",
  "5小时": "5h",
  "7天": "7d",
  "1天": "1d",
  "30天": "30d",
  "窗口": "window",
  "自定义 key": "Custom key",
  "KIMI 套餐额度": "KIMI plan quota",
  "MiniMax 套餐额度": "MiniMax plan quota",
  "智谱 套餐额度": "Zhipu plan quota",
  "z.ai 套餐额度": "z.ai plan quota",
  "DeepSeek 账户余额": "DeepSeek account balance",
  "Codex 账号额度": "Codex account quota",
  "Claude 账号额度": "Claude account quota",
  "Grok 账号额度": "Grok account quota",
  "中转站额度": "Relay quota",

  /* MCP/命令候选(渲染点在 composer 抽屉,主会话包裹) */
  "MCP 服务器": "MCP server",
  "全局": "Global",
  "项目": "Project",
  "查看可用命令": "Show available commands",
  "清屏": "Clear screen",
  "查看/切换模型(幕布内 picker)": "View/switch model (in-canvas picker)",
  "深度思考模式": "Deep thinking mode",
  "只读规划模式": "Read-only planning mode",
  "代码评审": "Code review",
  "清空对话上下文": "Clear conversation context",
  "压缩会话上下文(参数可选)": "Compact session context (optional arg)",
  "查看额度用量": "Show quota usage",
  "恢复历史会话(幕布内 picker)": "Resume a past session (in-canvas picker)",
  "会话与配置状态": "Session and config status",
  "查看改动 diff": "Show change diff",
  "初始化 AGENTS.md": "Initialize AGENTS.md",
  "压缩会话上下文": "Compact session context",
  "查看/管理审批规则": "View/manage approval rules",
  "查看/注入技能": "View/inject skills",
  "引用文件(需路径参数)": "Reference a file (path arg required)",
  "帮助与快捷键": "Help and shortcuts",
  "切换模型/思考模式(幕布内 picker)":
    "Switch model/thinking mode (in-canvas picker)",
  "会话列表与切换(幕布内 picker)":
    "List and switch sessions (in-canvas picker)",
  "新建会话": "New session",
  "重命名当前会话(需会话名)": "Rename current session (name required)",
  "压缩上下文": "Compact context",
  "用量与配额": "Usage and quota",
  "新建会话(清空上下文)": "New session (clears context)",
  "管理插件": "Manage plugins",
  "新建会话(别名 /clear)": "New session (alias /clear)",
  "列出并切换会话(别名 /resume /continue)":
    "List and switch sessions (aliases /resume /continue)",
  "列出可用模型(幕布内 picker)":
    "List available models (in-canvas picker)",
  "停止分享当前会话": "Stop sharing current session",
  "引导生成/更新 AGENTS.md": "Generate/update AGENTS.md interactively",
  "连接供应商并配置 API key(幕布内 picker)":
    "Connect providers and configure API keys (in-canvas picker)",
  "导出会话为 Markdown 并打开编辑器":
    "Export session as Markdown and open editor",
  "用 $EDITOR 编辑长消息": "Edit long messages with $EDITOR",
  "切换思考/推理块可见性": "Toggle thinking/reasoning block visibility",
  "切换工具执行详情": "Toggle tool execution details",
  "列出主题(幕布内 picker)": "List themes (in-canvas picker)",
  "帮助": "Help",
  "退出 opencode(别名 /quit /q)": "Quit opencode (aliases /quit /q)",
  "压缩会话上下文(别名 /summarize)":
    "Compact session context (alias /summarize)",
  "撤销上一条消息及其文件改动(需 Git 仓库)":
    "Undo last message and its file changes (Git repo required)",
  "重做一次撤销(需 Git 仓库)": "Redo an undo (Git repo required)",
  "分享当前会话": "Share current session",

  /* 引擎插件 meta(渲染点在市场清单/命令抽屉,主会话包裹) */
  "OMP CLI 引擎:会话扫描、配额、状态":
    "OMP CLI engine: session scanning, quota, status",
  "Claude Code 引擎:项目会话、skill 提示":
    "Claude Code engine: project sessions, skill hints",
  "Codex CLI 引擎:rollout 扫描、配额":
    "Codex CLI engine: rollout scanning, quota",
  "Kimi Code CLI 引擎:kimi-code 会话桶、config 状态":
    "Kimi Code CLI engine: kimi-code session buckets, config status",
  "Grok Build 引擎:会话扫描、配额、状态":
    "Grok Build engine: session scanning, quota, status",
  "OpenCode CLI 引擎:SQLite 会话、模型状态":
    "OpenCode CLI engine: SQLite sessions, model status",

  /* omp 离线精选目录描述(渲染点已 t() 透传) */
  "Magic Context 共享记忆库:跨 CLI 持久记忆与会话检索":
    "Magic Context shared memory: cross-CLI persistent memory and session search",
  "模型自维护的 TODO 清单,浮层常驻、压缩后不丢":
    "Model-maintained TODO list, always-on overlay, survives compaction",
  "模型向你发起结构化问卷(带类型选项),替代凭空猜测":
    "Structured questionnaires from the model (typed options) instead of guessing",
  "持久后台 shell 任务与只读委派代理":
    "Persistent background shell tasks and read-only delegate agents",
  "实时代码反馈:LSP / lint / 类型检查 / 结构分析":
    "Live code feedback: LSP / lint / type check / structure analysis",
  "单代理委派与脚本化多代理工作流":
    "Single-agent delegation and scripted multi-agent workflows",
  "网络搜索 / URL 抓取 / GitHub 克隆 / PDF 与视频理解":
    "Web search / URL fetching / GitHub clone / PDF and video understanding",
  "MCP(Model Context Protocol)服务器接入适配":
    "MCP (Model Context Protocol) server adapter",
  "Kiro OAuth 登录、额度用量与模型发现":
    "Kiro OAuth login, quota usage, and model discovery",
  "基于 jscpd 的重复代码检测插件":
    "Duplicate-code detection plugin based on jscpd",

  /* pi 配置面(cli-pi/configGui.ts;「全局配置」亦被 cli-omp/configGui.ts 消费) */
  "CLI 主题": "CLI theme",
  "全局配置": "Global config",
  "配置文件不是 JSON 对象": "Config file is not a JSON object",
  "默认思考强度": "Default thinking level",
  "默认模型": "Default model",

  /* omp 配置面(configGui 字段/配置源) */
  "模型角色路由": "Model role routing",
  "撞墙自动回退": "Auto-fallback on rate-limit walls",
  "回退链": "Fallback chains",
  "全局思考强度": "Global thinking level",
  "符号风格": "Symbol style",
  "prewalk": "prewalk",
  "自动压缩历史": "Auto-compact history",
  "记忆后端": "Memory backend",
  "网络搜索链": "Web search chain",
  "检查点": "Checkpoints",
  "安全扫描": "Security scanning",
  "流式工具摘要(ttsr)": "Streaming tool summary (ttsr)",
  "ttsr 打断模式": "ttsr interrupt mode",
  "免 key": "No key needed",
  "需 API key": "API key required",
  "OAuth 登录": "OAuth sign-in",
  "项目级({name})": "Project ({name})",
  "项目级 overlay 叠在全局之上;数组段(modelRoles / fallbackChains / providerChain)整体替换而非追加。首次保存时创建本文件。":
    "The project overlay stacks on top of global; array sections (modelRoles / fallbackChains / providerChain) are replaced wholesale, not appended. The file is created on first save.",

  /* omp 供应商认证(OmpProviderAuthPanel / OmpKeyDialog) */
  "供应商认证": "Provider authentication",
  "订阅授权": "Subscription auth",
  "API Key": "API Key",
  "写入 ~/.omp/agent/agent.db · 优先级高于环境变量":
    "Written to ~/.omp/agent/agent.db · takes precedence over environment variables",
  "OAuth 登录,token 自动刷新,由 omp CLI 存储":
    "OAuth sign-in; tokens refresh automatically and are stored by the omp CLI",
  "已授权": "Authorized",
  "未授权": "Not authorized",
  "自动刷新": "Auto-refresh",
  "已配置": "Configured",
  "未配置": "Not configured",
  "登录": "Sign in",
  "设置 Key": "Set key",
  "设置 Key — {name}": "Set key — {name}",
  "已保存 {id} 的 API Key": "Saved the API key for {id}",
  "已删除 {id} 的 API Key": "Deleted the API key for {id}",
  "已在内置终端打开 {name} 的登录流程,完成后回到此处查看状态":
    "Opened the {name} sign-in flow in the built-in terminal; come back here to check the status once it's done",
  "筛选供应商…": "Filter providers…",
  "没有匹配的供应商": "No matching providers",
  "显示全部 37 个供应商": "Show all 37 providers",

  /* omp models.yml 自定义供应商(面板 + 添加对话框) */
  "自定义供应商": "Custom providers",
  "写入 ~/.omp/agent/models.yml · 中转站 / 自定义模型":
    "Written to ~/.omp/agent/models.yml · relays / custom models",
  "添加供应商": "Add provider",
  "编辑配置": "Edit config",
  "编辑 models.yml": "Edit models.yml",
  "models.yml 原文": "models.yml raw",
  "{n} 个模型": "{n} models",
  "含 Key": "Has key",
  "无 Key": "No key",
  "还没有自定义供应商,点右上角「编辑配置」添加":
    "No custom providers yet — click “Edit config” at the top right to add one",
  "API Key(可空;建议 $ENV_VAR 引用)": "API Key (optional; a $ENV_VAR reference is recommended)",
  "协议": "Protocol",
  "模型(一行一个 id;高级字段用「编辑配置」)":
    "Models (one id per line; advanced fields via “Edit config”)",

  /* omp 添加供应商校验(modelsConfig.validateProviderInput;渲染点 = 对话框错误条) */
  "名称只能用字母/数字/中划线/下划线,且以字母或数字开头":
    "Names may only contain letters, digits, hyphens, and underscores, and must start with a letter or digit",
  "供应商「{name}」已存在": "Provider “{name}” already exists",
  "API 地址不能为空且不能含空白": "The API URL cannot be empty or contain whitespace",
  "未知协议: {api}": "Unknown protocol: {api}",
  "API Key 不能包含换行": "The API key cannot contain line breaks",
  "至少填写一个模型 id": "Enter at least one model id",
  "模型 id 不能含空白": "Model ids cannot contain whitespace",
} as Record<string, string>;
