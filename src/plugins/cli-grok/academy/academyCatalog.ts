/**
 * grok 学堂课程目录 —— grok 1.0.41 启动期子命令 + 会话内斜杠命令(5 章 31 条)。
 *
 * 真源与提取法:
 * - 启动期子命令(clap 直读):本机 `grok --help` / `grok mcp --help` 的
 *   Commands: 表(命令名+官方英文描述同表出现);grok 1.0.41。
 * - 斜杠命令(strings 双证):bin/grok-native 原生二进制 `strings -n 4`,
 *   每条均以「命令名与相邻描述/usage 提示字符串同时出现」为收录门槛;
 *   描述不明的(/rename /expand /copy /effort 等)一律舍去。
 * 中文讲解/详解/四段示例为 tmd-cli 侧人工内容。grok 升级后按同法重提。
 */
import type { AcademyCourse } from "@kernel/academy";
import { GROK_ACADEMY_LESSONS } from "./academyLessons";

export const GROK_ACADEMY_COURSE: AcademyCourse = {
  cliId: "grok",
  title: "grok 学堂",
  sourceVersion: "1.0.41",
  chapters: [
    { id: "start", title: "启动与账号", desc: "在终端里配好认证与诊断;这几条在普通终端跑,不是会话内斜杠命令", commands: [
      { name: "grok login", zh: "登录 Grok 账号", en: "Sign in to Grok", detail: "认证入口。为什么:没登录一切免谈;login 支持 OAuth 浏览器授权,也有 --device-auth 设备码模式(远程/无浏览器机器用它,拿码到手机上完成授权)。注意:凭据全局缓存,登录一次所有项目共用。", how: "welcome 引擎卡的凭据入口管理同一凭据", examples: [{ sc: "刚装好 grok,第一次启动", i: "grok login", o: "浏览器打开授权页(或提示选择登录方式)", e: "授权完成即已登录。远程 SSH 机器上加 --device-auth 走设备码,不用在本机开浏览器。" }] },
      { name: "grok logout", zh: "登出并清除缓存凭据", en: "Sign out and clear cached credentials", detail: "退认证。为什么:换号、借出机器、回收凭据时必须主动登出,光删配置可能留 token 残留。注意:登出后本机立刻不可用,确认有备用账号或 key 再操作。", examples: [{ sc: "这台共用机器登过我的号,要走人了", i: "grok logout", o: "已登出并清除本地凭据", e: "缓存凭据立即失效。退出前确认另一个账号可用,别把自己锁在外面。" }] },
      { name: "grok models", zh: "列出可用模型后退出", en: "List available models and exit", detail: "模型清单。为什么:想知道当前账号能用哪些模型、模型 ID 怎么写,一条命令列全;脚本里也常用它做可用性探测。注意:只列不清,不影响任何会话;会话内切模型用 TUI 的模型选择。", examples: [{ sc: "不确定账号里有哪些模型可选", i: "grok models", o: "逐行列出模型 ID 与描述后退出", e: "拿准确的模型 ID 去 --model 或配置文件里用,避免手滑写错名字。" }] },
      { name: "grok doctor", zh: "体检终端/剪贴板/颜色/输入支持", en: "Check terminal, clipboard, color, and input support without starting Grok", detail: "环境体检。为什么:TUI 显示花、剪贴板不灵、按键没反应,多半是终端能力问题;doctor 不启动 grok 就把诊断摆出来,还配 grok doctor fix <项> 自动修(如 terminal.ssh-wrap、terminal.tmux-clipboard)。注意:先 doctor 看,再按提示 fix,别盲改。", examples: [{ sc: "SSH 远程里用 grok,复制内容总是不进本机剪贴板", i: "grok doctor", o: "输出诊断报告(terminal/clipboard/color/input 各项状态)", e: "报告会点名哪项缺失;按提示跑 grok doctor fix terminal.ssh-wrap 做本地 SSH 包装,把远程复制转发回本机剪贴板。" }] },
      { name: "grok update", zh: "检查更新或安装指定版本", en: "Check for updates or install a specific version", detail: "自我升级。为什么:grok 迭代快,新命令新行为都在新版里;update 一条命令查最新并可装指定版本回滚。注意:更新前收尾会话;回滚装旧版用于规避新引入的问题。", examples: [{ sc: "同事说的新功能我这边没有", i: "grok update", o: "显示当前与最新版本,确认后升级", e: "升级完成重启 grok 生效。若新版有问题,可 grok update 装回指定旧版本。" }] },
    ] },
    { id: "sessions", title: "会话:找回、翻页与分身", desc: "grok 的一切都在会话里;会找回、会回退、会分身,就掌握了主线", commands: [
      { name: "resume", zh: "恢复一个历史会话", en: "Resume a previous session", detail: "找回现场。为什么:昨天做到一半的活,今天第一件事就是 resume;恢复的是完整对话现场,不用重新交代背景。注意:弹出的选择器里认准会话——这就是养成改名习惯的价值;tmd-cli 侧栏 grok 分组点历史会话等效恢复。", how: "侧栏 grok 分组点历史会话等效恢复;重启会话也可 grok -r", examples: [{ sc: "昨天改到一半的解析器,今天继续", i: "/resume", o: "弹出会话选择器(列出历史会话)", e: "选中即回到完整现场。找哪个会话靠标题认,起名趁早。" }] },
      { name: "rewind", zh: "回退到之前某一轮", en: "Rewind to a previous turn", detail: "时光倒流。为什么:agent 跑偏了不想从头再来,rewind 把会话退回指定轮次,从那里换个说法重跑;被回退的轮次作废,文件改动不会自动还原。注意:回退是会话级操作,已落盘的代码改动要自己用 git 处理。", examples: [{ sc: "agent 上一轮把方案理解歪了,越走越远", i: "/rewind", o: "选择要回退到的轮次 → 会话退回该点", e: "从选中的轮次重新对话,之后的错误分支被丢弃。配合 git 在回退前先确认工作区干净或已提交。" }] },
      { name: "fork", zh: "把当前会话分叉出一个分身", en: "Branch the current session into a peer agent", usage: "[--worktree|--no-worktree] [directive]", detail: "并行分身。为什么:同一个起点想跑两条独立路线,fork 复制现场各跑各的;带 --worktree 还能给分身独立的工作树,两条线改代码互不踩脚。注意:分身是全新会话,原会话照旧;带 directive 可直接给分身下达第一句指令。", examples: [{ sc: "一个需求想同时试两套方案,各自独立改代码", i: "/fork --worktree 试试方案 B,缓存层换 Redis", o: "新分身会话已建立(带独立 worktree)", e: "分身从当前现场出发独立推进,原会话不受影响。分身多了顾不过来,两套方案都值得跟才值得分。" }] },
      { name: "delete", zh: "删除当前会话", en: "Delete this session", detail: "清理会话。为什么:试错产生的垃圾会话越积越多,delete 直接清掉当前的;删除不可恢复,含价值的结论先抄走。注意:删的是当前会话本体;批量清理在 tmd-cli 侧栏会话管理面做更直观。", how: "批量删除走 tmd-cli 侧栏会话管理", examples: [{ sc: "一个纯试错的会话跑完没价值了", i: "/delete", o: "当前会话已删除", e: "会话从磁盘清掉。删之前确认没有要留的结论或代码改动。" }] },
      { name: "session-info", zh: "查看当前会话信息", en: "Show session info", detail: "会话档案。为什么:「这个会话用的什么模型、上下文占用了多少」一条命令看全;排查和汇报都用得上。注意:统计是当前会话口径,花费账单看 /usage 或 tmd-cli 引擎面板。", examples: [{ sc: "想确认当前会话的模型与上下文占用", i: "/session-info", o: "显示会话信息(模型、上下文、路径等)", e: "上下文占比高就考虑压缩(/compact)或开新会话。" }] },
      { name: "jump", zh: "跳转到历史某一轮", en: "Jump to a turn in the conversation", detail: "长会话导航。为什么:几百轮的会话里翻找某次结论,滚屏翻到眼花;jump 直接定位到那一轮,配合 /find 搜内容用。注意:minimal 渲染模式下没有独立滚动面板,搜索交给终端自己的 scrollback。", examples: [{ sc: "记得早前聊过某个接口约定,要翻回去核对", i: "/jump", o: "选择历史轮次 → 视图跳到该处", e: "先 /find 关键词搜到大概位置,再 jump 精确定位,比滚动翻页快得多。" }] },
      { name: "grok sessions", zh: "列出/搜索/恢复会话(终端命令)", en: "List, search, or restore sessions", detail: "终端侧会话管理。为什么:不开 TUI 也能查历史——脚本里列会话、按关键词搜、直接恢复某个会话都靠它;配合 -r/--resume 与 --fork-session 还能派生新会话 ID。注意:这是 grok 的顶层子命令,在普通终端跑,不是会话内斜杠命令。", examples: [{ sc: "想在不进 TUI 的情况下找上周那个会话", i: "grok sessions", o: "列出会话(ID、标题、时间)", e: "拿到会话 ID 后 grok --resume <id> 直接恢复;搜索加子参数按标题/关键词过滤。" }] },
    ] },
    { id: "context", title: "上下文与规划", desc: "上下文要会压缩,长活要先规划——这是 grok 续命与少跑偏的关键", commands: [
      { name: "plan", zh: "进入规划模式", en: "Enter plan mode", usage: "[description]", detail: "先想后做。为什么:大活直接让 agent 动手容易跑偏;plan 模式只读代码出方案、不动文件,你确认方案后再执行,返工成本最低。注意:带描述可直接下达要规划的任务;方案确认后退出规划正常干活。", examples: [{ sc: "要重构支付模块,先让它给方案再动手", i: "/plan 重构支付模块,先出迁移方案", o: "进入规划模式,agent 只读代码并产出方案", e: "方案满意再让它执行。大改动一律先 plan,砍掉大半返工。" }] },
      { name: "compact", zh: "手动压缩会话上下文", en: "Compact conversation history", detail: "压缩上下文。为什么:上下文越长越贵越迟钝;compact 把历史压成摘要腾出空间,长任务续命全靠它。注意:压缩有损,关键约束(文件路径、接口签名)在压缩前的对话里再强调一遍,别赌摘要全记住。", examples: [{ sc: "长会话跑了半天,回复开始变慢变贵", i: "/compact", o: "会话历史被压成摘要,上下文腾出空间", e: "压缩后继续干活。重要细节丢不得的,先写进项目记忆或文档再压。" }] },
      { name: "find", zh: "搜索会话滚动内容", en: "Search the conversation scrollback", usage: "[text]", detail: "会话内搜索。为什么:几百轮的会话里找一句结论,jump 之前先用 find 定位;搜的是会话内容不是代码。注意:minimal 渲染模式没有独立滚动面板,改用终端自己的搜索。", examples: [{ sc: "记得早前定过接口前缀,搜出来核对", i: "/find api 前缀", o: "高亮/列出匹配位置", e: "找到后配合 /jump 跳过去看上下文。搜不到换个更短的关键词再试。" }] },
      { name: "history", zh: "搜索历史 prompt", en: "Search prompt history", detail: "提示词档案。为什么:上周打磨好的那段复杂指令还想再用,history 按关键词搜回历史输入,直接复用不用重写。注意:搜的是你发过的 prompt,不是 agent 的回复;跨会话生效。", examples: [{ sc: "上次写的一段很长的测试生成指令想复用", i: "/history 测试生成", o: "列出匹配的历史 prompt", e: "选中即取回原文,改改参数重新发送。常用流程沉淀成 skill 或项目文档更稳。" }] },
      { name: "usage", zh: "查看用量与账单入口", en: "Show or manage billing and usage", usage: "[show|manage]", detail: "花钱看板。为什么:token 花在哪、余额还剩多少,/usage show 一屏看本会话与账号口径;/usage manage 直达账单管理页。注意:会话内统计看 /session-info,这里看的是计费口径。", examples: [{ sc: "感觉这个月消耗有点快,想看明细", i: "/usage show", o: "显示 token 用量与费用汇总", e: "确认是哪些会话在烧钱;要改套餐或绑卡走 /usage manage。" }] },
    ] },
    { id: "extend", title: "扩展:工具接入与自动化", desc: "MCP 挂外部工具,插件/代理定义扩能力,/loop /workflow 让活自己跑", commands: [
      { name: "mcps", zh: "查看 MCP 服务器状态", en: "Show MCP server status", detail: "MCP 面板。为什么:挂了一堆 MCP 工具后「哪个连上了、哪个挂了」要一眼可见;mcps 显示状态,配置的增删在 grok mcp(终端命令)或配置文件里做。注意:连接失败的服务器在这里先看到,再去 grok mcp doctor 深查。", examples: [{ sc: "配了几个 MCP 服务器,想确认都连上了", i: "/mcps", o: "列出各 MCP 服务器与连接状态", e: "有 disconnected 的先看报错;深入诊断跑 grok mcp doctor <名字>。" }] },
      { name: "grok mcp", zh: "管理 MCP 服务器配置(终端命令)", en: "Manage MCP server configurations", subs: [{ name: "list", en: "List configured MCP servers" }, { name: "add", en: "Add or update an MCP server", usage: "grok mcp add <name> -- <command> [args...]" }, { name: "remove", en: "Remove an MCP server" }, { name: "enable", en: "Enable an MCP server" }, { name: "disable", en: "Disable an MCP server" }, { name: "doctor", en: "Diagnose MCP server configuration and connectivity" }], detail: "MCP 配置管理。为什么:外部工具(数据库、文件系统、Sentry 等)都从 mcp add 进来;stdio 本地进程、http/sse 远程服务三种接法,enable/disable 控制启停,doctor 逐个体检连通性。注意:add 本地命令用 `--` 分隔名字与命令;远程默认按 URL 推断 http,要 sse 就 --transport sse 显式声明。", examples: [{ sc: "要给 grok 挂上官方文件系统 MCP", i: "grok mcp add filesystem -- npx -y @modelcontextprotocol/server-filesystem /path/to/dir", o: "MCP server filesystem 已写入配置", e: "重启会话后生效,/mcps 确认连接。远程服务如 sentry:grok mcp add --transport http sentry https://mcp.sentry.dev/mcp。" }] },
      { name: "plugins", zh: "管理插件(添加/安装/启停)", en: "Manage plugins", detail: "插件面板。为什么:插件带来命令、技能与钩子;plugins add 本地目录、install 装市场源,enable/disable 控制启停。注意:新装的插件要先信任才激活钩子与 MCP;老的 trust/untrust 已被 enable/disable 取代,提示了就换新写法。", examples: [{ sc: "装一个本地开发的插件试试", i: "/plugins install ./local-plugin", o: "插件已安装(按提示信任/启用)", e: "装完在 /plugins 列表里 enable;来源不明的插件先读它的钩子代码再信任。" }] },
      { name: "config-agents", zh: "管理 agent 定义", en: "Manage agent definitions", detail: "子代理配置。为什么:grok 支持自定义 agent(专攻某类任务的子代理),config-agents 集中查看与编辑这些定义;启动时也能 --agent <名字> 直接指定。注意:定义文件改完对新会话生效;不想让会话派子代理用 --no-subagents。", examples: [{ sc: "想看看项目里配了哪些专用 agent", i: "/config-agents", o: "列出 agent 定义(可查看/编辑)", e: "给不同任务配专职 agent(如只跑测试的),主会话按需调用,职责更清晰。" }] },
      { name: "hooks", zh: "管理会话钩子", en: "Manage hooks", usage: "add <path>", detail: "事件钩子。为什么:想在特定事件(工具调用前后等)自动跑自己的命令,hooks add 把脚本挂进来,让流程自动化。注意:钩子来自文件路径,加载/卸载都要重启会话才生效;来源不明的钩子脚本别乱挂——它以你的环境权限运行。", examples: [{ sc: "想在每次改文件后自动跑 lint", i: "/hooks add ./hooks/after-edit.sh", o: "钩子已添加(提示重启会话生效)", e: "重启会话后钩子随事件自动执行。先小范围验证钩子行为,再挂到常用项目。" }] },
      { name: "loop", zh: "让一句 prompt 定时反复执行", en: "Run a prompt on a recurring interval", usage: "[interval] <prompt>", detail: "自动巡检。为什么:「每 5 分钟看一眼 CI」这类值守活不该占着你打字;loop 把 prompt 挂上间隔反复跑,你盯着结果就行。注意:间隔写法跟在 prompt 前;不用了记得停掉,后台循环会持续消耗 token。", examples: [{ sc: "让 agent 每隔一段时间检查测试是否还绿", i: "/loop 10m 跑一遍测试,红了就报告原因", o: "循环任务已建立(每 10 分钟执行一次)", e: "grok 自动周期执行并汇报。值守结束及时取消,避免无效消耗。" }] },
      { name: "workflow", zh: "运行/管理保存的工作流", en: "Manage saved workflows", usage: "<name> [args] | <op> [name]", detail: "流程复用。为什么:一套打磨好的多步流程(排查、发布检查)存成 workflow 后,workflow <名字> 一键按谱跑;不带参数进运行总览。注意:工作流是可以保存复用的任务编排,与一次性 /loop 不同;参数跟在名字后传入。", examples: [{ sc: "每次发版前都要走同一套检查清单", i: "/workflow release-check", o: "按保存的流程逐步执行并汇报", e: "固定流程固化成 workflow,执行不走样;流程变了改定义而不是每次重打。" }] },
    ] },
    { id: "extras", title: "多媒体、文档与日常", desc: "画图、生视频、深度调研、查文档——grok 的加分项与日常维护", commands: [
      { name: "imagine", zh: "文生图", en: "Generate an image from a text description", usage: "<description>", detail: "会话里直接生图。为什么:要配图、示意图、灵感图时不用切走开别的工具,imagine 一句话出图。注意:描述写越具体效果越稳(主体、风格、构图);生成走模型额度,批量出图前想清楚。", examples: [{ sc: "项目 README 缺一张封面图", i: "/imagine 极简风格的终端窗口插画,深色背景,蓝紫渐变", o: "生成图片并在会话中展示", e: "不满意就调整描述再来一张;满意后保存到仓库使用。" }] },
      { name: "imagine-video", zh: "文生视频", en: "Generate a video from a text description", usage: "<description>", detail: "会话里直接生成短视频。为什么:演示动效、产品概念短片,一句话出素材。注意:视频生成比生图更贵更慢,先想清楚用途;描述里把镜头运动和主体动作写明白。", examples: [{ sc: "要一段几秒的加载动效概念演示", i: "/imagine-video 深色背景下终端光标闪烁并逐行打印代码的特写", o: "生成短视频并在会话中展示", e: "拿去做演示素材;效果不对改描述重生成。" }] },
      { name: "deep-research", zh: "发起深度调研", en: "Deep-research workflow", usage: "<query>", detail: "多轮自动调研。为什么:开放性问题(选型对比、方案调研)一句普通提问只能得到浅答;deep-research 走专门的调研流程,多轮检索汇总成报告。注意:耗时长、消耗大,值得认真回答的问题才用它;轻量问题直接问就行。", examples: [{ sc: "要给团队写一份技术选型对比", i: "/deep-research 对比 2026 年主流 agent 框架的沙箱与权限模型", o: "进入调研流程,分多轮检索后输出汇总报告", e: "报告可直接作为决策底稿;等结果的间隙去干别的。" }] },
      { name: "docs", zh: "打开官方文档", en: "Open docs.x.ai/build in the browser", usage: "[web|title]", detail: "文档直达。为什么:找 API 说明、入门指南不用自己开浏览器搜;docs 直达 docs.x.ai/build,带标题还能精确打开某篇 guide。注意:参数写不清会提示可用目标;纯网页搜索用 /docs web。", examples: [{ sc: "想翻一下官方入门指南", i: "/docs howto", o: "浏览器打开对应文档页", e: "文档在浏览器里读,问题回到 grok 会话里继续问。" }] },
      { name: "help", zh: "浏览全部命令与快捷键", en: "Browse commands and keyboard shortcuts", detail: "命令总表。为什么:grok 的斜杠命令几十条,help 一屏列全;忘了命令名、想找有没有现成能力,先 help 再猜。注意:看的是当前版本的可用命令;升级后扫一眼有没有新东西。", examples: [{ sc: "不确定 grok 有没有导出会话的能力", i: "/help", o: "列出全部斜杠命令与说明", e: "按分类浏览找到目标命令;配合 /find 在长列表里搜关键词。" }] },
      { name: "release-notes", zh: "查看当前版本的更新日志", en: "View release notes for the current version", detail: "更新说明。为什么:grok 升级频繁,新命令新行为都在 release notes 里;升级后扫一眼,别用旧习惯错新版本。注意:离线时看不了;想看全部历史去仓库 releases 页。", examples: [{ sc: "刚升级完 grok,想知道有什么新东西", i: "/release-notes", o: "显示当前版本更新条目", e: "重点看 breaking changes 和新命令,养成升级后扫一眼的习惯。" }] },
      { name: "quit", zh: "退出 grok", en: "Quit the application", detail: "退出应用。为什么:终端里退出要干净——会话自动落盘不怕丢;但跑着的 /loop、后台任务会停。注意:收工前瞄一眼 /session-info 确认没有值守任务在跑,再退。", examples: [{ sc: "今天的活干完了,关终端走人", i: "/quit", o: "grok 退出(会话已保存)", e: "会话已落盘,明天 /resume 接着来。有 /loop 值守先停掉再退。" }] },
    ] },
  ],
  lessons: GROK_ACADEMY_LESSONS,
};
