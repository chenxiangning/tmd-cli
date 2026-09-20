/** en 词典 · cli 域续篇:cli-config 表单/建议表/omp 配置说明(动态键 2026-09-20 审计;键 = 中文源串)。 */
export const MESSAGES = {
  /* cli-config 表单 label(cli-claude / cli-codex configGui) */
  "始终思考": "Always thinking",
  "提交署名": "Commit attribution",
  "主模型覆盖": "Primary model override",
  "Opus 档覆盖": "Opus tier override",
  "Sonnet 档覆盖": "Sonnet tier override",
  "Haiku 档覆盖": "Haiku tier override",
  "请求超时(ms)": "Request timeout (ms)",
  "服务商": "Provider",
  "推理力度": "Reasoning effort",
  "网页搜索": "Web search",
  "禁用响应存储": "Disable response storage",
  "服务档位": "Service tier",

  /* codex 配置源 note(cli-codex configGui sources) */
  "config.toml 的 [model_providers] / [projects] / [mcp_servers] 等段由 Codex 自管理;GUI 只编辑顶层平面键,保存为行级补丁,未知段落与注释原样保留。":
    "Sections such as [model_providers] / [projects] / [mcp_servers] in config.toml are managed by Codex itself; the GUI only edits top-level flat keys, saves as a line-level patch, and leaves unknown sections and comments untouched.",

  /* 命令建议 description(cli-shared/qoderSessionModel) */
  "审查改动代码的复用/质量/效率并修复":
    "Review changed code for reuse/quality/efficiency and fix it",
  "两阶段特性开发:先方案确认再实现":
    "Two-phase feature development: confirm the plan first, then implement",
  "交互式管理 MCP 服务器配置": "Manage MCP server configs interactively",
  "定时循环执行 prompt 或命令(需参数)":
    "Run a prompt or command on a timed loop (argument required)",
  "启动并驱动项目应用验证改动": "Launch and drive the project's app to verify changes",
  "提交问题反馈": "Submit feedback",

  /* omp 配置说明(cli-omp/configDetails;整段键,按换行拆行;冒号前导语由消费点加粗) */
  "解决什么问题:不同活儿值得用不同模型——探索代码库用便宜快模型、写核心逻辑用强模型。角色路由让你给每种活儿指定默认模型,不用每次手动切换。":
    "What it solves: different jobs deserve different models — a cheap fast one for exploring the codebase, a strong one for writing core logic. Role routing lets you assign a default model to each kind of job instead of switching by hand every time.",
  "影响什么:改这里只是改「默认用谁」,不会动你已登录的供应商。角色后面可以加「:思考强度」后缀,比如 qwen-cn/Qwen3.8 Max:high。":
    "What it affects: this only changes “who is used by default”; it never touches the providers you are signed in to. A role can take a “:thinking-level” suffix, e.g. qwen-cn/Qwen3.8 Max:high.",
  "9 个角色各是什么:": "The 9 roles:",
  "· default —— 主对话模型,日常干活都用它":
    "· default — the main conversation model; everyday work runs on it",
  "· smol —— 便宜快模型,prewalk、计划执行等场景自动切过去":
    "· smol — the cheap fast model; prewalk, plan execution and similar scenes switch to it automatically",
  "· slow —— 慢而强的模型,留给重活(如大范围重构审查)":
    "· slow — slow but strong, reserved for heavy jobs (e.g. reviewing large-scale refactors)",
  "· plan —— 计划模式专用,只读分析、产出计划":
    "· plan — planning mode only; read-only analysis that produces the plan",
  "· advisor —— 顾问角色,被动审查每轮结果并给建议":
    "· advisor — the advisor role; passively reviews each turn's results and offers suggestions",
  "· commit —— 生成 git 提交信息专用":
    "· commit — dedicated to generating git commit messages",
  "· reasoning —— 攻坚推理(难题拆解、复杂调试)":
    "· reasoning — hard-problem reasoning (breaking down tough problems, complex debugging)",
  "· title —— 生成会话标题(要求快和便宜)":
    "· title — generates session titles (needs to be fast and cheap)",
  "· memory —— 记忆后台整理(dream/reflect)用的模型":
    "· memory — the model used for background memory upkeep (dream/reflect)",
  "解决什么问题:主模型限流、报错、超时(俗称撞墙)时,会话不至于卡死重来。":
    "What it solves: when the main model rate-limits, errors out, or times out (hitting the wall, colloquially), the session doesn't stall and restart from scratch.",
  "影响什么:开启后 omp 撞到失败会自动按回退链换下一个模型继续;关掉则撞墙直接报错,由你自己处理。默认开,建议保持。":
    "What it affects: enabled, omp automatically moves to the next model in the fallback chain after a failure and keeps going; disabled, hitting the wall surfaces the error directly for you to handle. On by default; recommended to keep.",
  "解决什么问题:撞墙回退时「换谁、换几个、什么顺序」由你说了算,而不是 omp 自己猜。":
    "What it solves: when a fallback fires, you decide “who to switch to, how many candidates, in what order” instead of omp guessing.",
  "影响什么:按角色配链;每个角色下可以加多个候选模型,按顺序逐个尝试——比如 default 角色配 A、B 表示主模型撞墙先换 A、再不行换 B,可以用箭头调整顺序。不配就用 omp 内置顺序。注意:项目级配置里数组是整体替换语义,项目里的链会完全盖掉全局的链,不是合并。":
    "What it affects: chains are configured per role; each role can hold multiple candidate models tried in order — e.g. giving default the chain A, B means on hitting the wall the main model switches to A first, then to B if that fails too; use the arrows to reorder. Roles left unconfigured use omp's built-in order. Note: in project-level config, arrays follow replace-wholesale semantics — a project chain fully overrides the global chain rather than merging.",
  "解决什么问题:思考强度决定模型回答前「想多久」——想得多更准但更慢更贵,想得少更快更便宜。":
    "What it solves: the thinking level decides “how long the model thinks” before answering — thinking more is more accurate but slower and pricier; thinking less is faster and cheaper.",
  "影响什么:auto 让模型自己决定;off/minimal 适合闲聊和简单问答;medium/high 适合日常写代码;max 适合攻坚难题。这里是全局默认;角色后缀(如 :high)优先于它。":
    "What it affects: auto lets the model decide; off/minimal suits chit-chat and simple Q&A; medium/high suits everyday coding; max suits grinding through hard problems. This is the global default; a role suffix (e.g. :high) takes precedence over it.",
  "解决什么问题:有些终端字体不支持 Unicode 图形符号,omp 界面里的图标和进度条会变成方框或问号。":
    "What it solves: some terminal fonts lack Unicode graphic symbols, so icons and progress bars in the omp UI turn into boxes or question marks.",
  "影响什么:unicode 用图形符号(好看,绝大多数终端没问题);ascii 退化成纯文本字符(兼容性最好)。只影响界面显示,不影响功能。":
    "What it affects: unicode uses graphic symbols (nicer looking; fine on the vast majority of terminals); ascii degrades to plain text characters (best compatibility). This only affects display, not functionality.",
  "解决什么问题:让强模型做计划、便宜模型干活,省钱又不牺牲规划质量。":
    "What it solves: let a strong model do the planning and a cheap model do the work — saving money without sacrificing planning quality.",
  "影响什么:开启后,当计划确定(todo 列表生成)且第一次要改文件时,omp 自动从当前模型切到 smol 角色的便宜模型跑实现;单次想禁用可以用 --no-prewalk。关掉则全程用当前模型。":
    "What it affects: enabled, once the plan is settled (the todo list is generated) and the first file edit is due, omp automatically switches from the current model to the cheap smol-role model for implementation; use --no-prewalk to disable it for a single run. Disabled, the current model runs the whole way.",
  "解决什么问题:会话越来越长会撞上下文上限,旧消息要么被截断丢失,要么得手动 /compact 整理。":
    "What it solves: as a session grows it hits the context limit, where old messages either get truncated away or you have to tidy up manually with /compact.",
  "影响什么:开启后接近上限时自动把早期对话压缩成摘要,会话可以一直续下去且关键结论保留;代价是压缩本身花一次模型调用。关掉则到上限只能开新会话。建议开启。":
    "What it affects: enabled, early conversation is automatically compressed into a summary as you near the limit, so the session can continue indefinitely with key conclusions kept; the cost is one model call for the compaction itself. Disabled, hitting the limit means starting a new session. Recommended on.",
  "解决什么问题:默认 omp 每次会话都是「失忆」的——上周发现的结论、踩过的坑,新会话全不知道。":
    "What it solves: by default every omp session “has amnesia” — conclusions from last week, pitfalls already hit; a new session knows none of it.",
  "影响什么:off = 完全关闭记忆;local = 本地 Markdown 文件记忆,简单透明可直接翻看;mnemopi = 本地 SQLite 向量检索,记忆多了以后召回更准。开启后 omp 会把重要事实沉淀下来,后续会话自动带上相关记忆。":
    "What it affects: off = memory fully off; local = local Markdown-file memory, simple and transparent, readable directly; mnemopi = local SQLite vector retrieval, with better recall as memories pile up. Once on, omp settles important facts into memory and later sessions automatically bring the relevant memories along.",
  "解决什么问题:这里配的是「搜索服务商」(帮你查网页的),不是对话模型——两者是两套账号两套凭据。单一来源会限流或挂掉,配一条链可以自动互相替补。":
    "What it solves: this configures “search providers” (the ones that look up web pages for you), not the chat model — the two are separate accounts with separate credentials. A single source will rate-limit or die; a chain lets them back each other up automatically.",
  "怎么选:下拉里的标注就是你要的准备——「免 key」的直接能用(duckduckgo/startpage/google 等 5 个);「OAuth 登录」的只要你在 omp 里登录过对应账号(gemini/anthropic/codex/xai/kimi);「需 API key」的要自己去服务商买 key 并配到环境变量(如 EXA_API_KEY)。不配任何链 = 用 omp 内置的 auto 顺序(它会按固定顺序把所有 provider 试一遍)。":
    "How to choose: the labels in the dropdown tell you what to prepare — “No key needed” ones work right away (duckduckgo/startpage/google and 5 in total); “OAuth sign-in” ones only need you to have signed in to that account in omp (gemini/anthropic/codex/xai/kimi); “API key required” ones need you to buy a key from the provider yourself and put it in an environment variable (e.g. EXA_API_KEY). No chain configured = omp's built-in auto order (it tries every provider in a fixed sequence).",
  "影响什么:链内按顺序逐个尝试,前面失败/超时(单家 60 秒)自动换下一个;pin 单家就只写一个名字。不写 key 的免费源质量一般,付费源综合质量更好。":
    "What it affects: the chain tries members in order; on failure/timeout (60 seconds per provider) it moves on to the next automatically; pin to a single provider by writing just one name. Free sources that need no key are mediocre in quality; paid sources are better overall.",
  "解决什么问题:让 AI 同时探索几个方案时,上下文会被探索过程塞满,想「回到分歧点重来」只能靠翻历史。":
    "What it solves: when the AI explores several approaches at once, the context fills up with the exploration itself; going “back to the fork to start over” means digging through history.",
  "影响什么:开启后 omp 多出 checkpoint/rewind 两个能力——重要节点打个快照,探索完可以带着结论报告回溯到锚点、剪掉中间过程。注意它只回溯对话状态,不回滚文件、不碰 git。默认关。":
    "What it affects: enabled, omp gains two capabilities — checkpoint/rewind: snapshot at important nodes, then after exploring, rewind to the anchor with the conclusions in hand and prune the intermediate steps. Note it only rewinds conversation state — it does not roll back files or touch git. Off by default.",
  "解决什么问题:AI 生成代码时可能顺手把 API key 写进提交,或引入已知的危险写法。":
    "What it solves: code the AI writes might slip an API key into a commit or introduce known dangerous patterns.",
  "影响什么:开启后提交前自动扫描 secrets(密钥泄露)和恶意模式。默认关;对安全性要求高的仓库建议开启。":
    "What it affects: enabled, a scan for secrets (leaked credentials) and malicious patterns runs automatically before committing. Off by default; recommended for repos with high security requirements.",
  "解决什么问题:工具跑出一坨输出时,你得自己盯着原始日志才知道发生了什么。":
    "What it solves: when a tool dumps a pile of output, you would otherwise have to watch the raw logs yourself to know what happened.",
  "影响什么:开启后 omp 对工具输出做实时流式摘要,长命令的进展一目了然;摘要注入是持久化的,即使上下文被压缩也不会丢。默认开。":
    "What it affects: enabled, omp summarizes tool output as it streams — long-command progress at a glance; the summary injection is persistent, surviving context compaction. On by default.",
  "解决什么问题:流式摘要命中规则时,是立刻打断当前输出,还是等它说完再补?":
    "What it solves: when a streaming summary matches a rule, should it interrupt the current output immediately, or wait until it finishes and append then?",
  "影响什么:always = 随时可打断(正文里命中也会中止当前流重发);manual = 不主动打断,等消息完成后再补注。默认 always。":
    "What it affects: always = can interrupt any time (a match in the body also aborts the current stream and resends); manual = never interrupts proactively; the annotation is added after the message completes. Default: always.",
} as Record<string, string>;
