/**
 * kimi 学堂课程目录 —— kimi 2.1.1 全部 43 条内置斜杠命令(6 章)。
 *
 * 真源与提取法:本机原生二进制 /Users/chenxiangning/.kimi-code/bin/kimi
 * (Mach-O arm64 内嵌 JS bundle)strings 提取,直读 src/tui/commands/registry
 * 的 BUILTIN_SLASH_COMMANDS 注册表,逐条核对名称/别名/描述/argumentHint/
 * availability 同块成对出现;tower/swarm/goal 语义另经 bundle 相邻实现
 * 字符串佐证(worktree 编排、并发预算、goal pause/resume)。中文讲解/
 * 详解/四段示例为 tmd-cli 侧人工内容。kimi 升级后按同法重提。
 */
import type { AcademyCourse } from "@kernel/academy";
import { KIMI_ACADEMY_LESSONS } from "./academyLessons";

export const KIMI_ACADEMY_COURSE: AcademyCourse = {
  cliId: "kimi",
  title: "kimi 学堂",
  sourceVersion: "2.1.1",
  chapters: [
    { id: "sessions", title: "会话:开始、找回与翻篇", desc: "会话是你和 agent 的连续现场;会开、会找、会撤回,就掌握了主线", commands: [
      { name: "new", zh: "在当前工作区开始全新会话", detail: "换任务先翻篇。为什么:旧上下文会拖慢回复、带偏新任务;new 在当前工作区开一张白纸,旧会话完整留盘随时 /sessions 找回。别名 /clear——kimi 没有「清屏不清上下文」的半吊子做法,新会话即翻篇。", examples: [{ sc: "手头 bug 修完,要开始写新功能", i: "/new", o: "当前工作区已开启全新会话(上下文清空)", e: "旧会话留盘、新会话零成本。开新前把新任务背景一次交代清楚,别指望它记得上一会话的事。" }] },
      { name: "sessions", zh: "浏览并恢复历史会话", detail: "找回现场。为什么:昨天做到一半的活,今天打开 kimi 第一件事就是 sessions;选择器列出全部历史会话,选中即恢复完整上下文。别名 /resume。tmd-cli 侧栏 kimi 分组点一下等效。", how: "侧栏历史会话点一下等效恢复", examples: [{ sc: "昨天改到一半的解析器,今天继续", i: "/sessions", o: "弹出会话选择器(列出历史会话)", e: "选中即回到完整现场,不用重新交代背景。会话多时先想想当时有没有 /title 起名,按时间找最近的。" }] },
      { name: "title", zh: "设置或查看会话标题", detail: "会话命名。为什么:一周后翻会话列表时,「未命名会话」和「修支付回调」的找回成本天差地别;标题是未来自己的路标。别名 /rename;不带参数显示当前标题。", usage: "<title>", how: "侧栏会话右键重命名等效", examples: [{ sc: "刚开始一个要跑三天的重构任务", i: "/title 支付回调重构", o: "会话标题已设置", e: "列表里一眼认出。起名趁早——拖到会话堆成山,就只能靠内容猜了。" }] },
      { name: "undo", zh: "从会话记录中撤回上一条 prompt", detail: "后悔药。为什么:指令贴错文件路径、附件传错,让错误输入留在上下文里会持续误导 agent;undo 把最近一条 prompt 整条抽走,当没说过。仅会话空闲时可用——回复已经开始就等它停。", examples: [{ sc: "刚发的指令贴错了仓库路径,agent 还没开跑", i: "/undo", o: "上一条 prompt 已从会话记录中撤回", e: "错误输入不进上下文,直接重发正确指令即可。撤回只对最后一条生效,更早的靠 /fork 重开。" }] },
      { name: "fork", zh: "把当前会话复制为分叉副本(不切换)", detail: "试错保险。为什么:接下来要跑危险操作或想试另一条路线,fork 复制当前完整现场成一份新会话,自己仍留在原地——副本随便折腾,本体毫发无损。与 pi 选历史消息分叉不同,kimi 直接复制当下这一刻。", examples: [{ sc: "马上要让 agent 批量重构,先留一份存档", i: "/fork", o: "已分叉出会话副本(当前会话不变)", e: "搞砸了用 /sessions 切回本体重来,相当于免费时光机。副本记得 /title 起名,不然回头分不清谁是谁。" }] },
      { name: "compact", zh: "压缩会话上下文", detail: "长任务续命。为什么:上下文越长越贵越迟钝;compact 把历史压成摘要腾空间。带指示告诉它「压缩时保留哪些细节」,关键约束(文件路径、接口签名)点名才保得住。", usage: "<instruction>", examples: [{ sc: "长会话跑了半天,回复开始变慢变贵", i: "/compact 保留 parse.ts 的接口签名与已修复文件清单", o: "会话上下文已压缩", e: "历史被压成摘要,点名的细节保留。压缩有损不可逆——重要约束一定写进指示,别赌摘要自己会记住。" }] },
      { name: "exit", zh: "退出 kimi", detail: "收工。为什么:终端里退出要干净——会话自动落盘不怕丢,但跑着的后台任务会停在那。别名 /quit 和 /q,指头最短的那个最好记。", examples: [{ sc: "今天的活干完了,关终端走人", i: "/exit", o: "kimi 退出(会话已保存)", e: "会话状态已落盘,明天 /sessions 接着来。有未完成的长任务先等收尾或确认可中断。" }] },
    ] },
    { id: "model", title: "模型、思考与账号", desc: "模型决定智商与花费,思考强度决定深浅;认证决定能不能跑", commands: [
      { name: "model", zh: "切换 LLM 模型", detail: "切模型。为什么:读代码要强脑、跑杂活要省钱;model 弹出选择器,浏览全部可用模型回车即切。kimi 的模型真相写回全局 config.toml 并即时生效,tmd-cli 工具栏的模型 pill 由此只读展示。", how: "tmd-cli 工具栏模型 pill 为只读展示,切换在 CLI 内完成", examples: [{ sc: "要开始读大量代码,换强模型", i: "/model", o: "弹出模型选择器(Enter 切换)", e: "切换只影响后续回复,已产生的上下文不动。切完瞄一眼工具栏 pill 确认生效。" }] },
      { name: "effort", zh: "切换思考强度", detail: "调思考档位。为什么:难任务要深想(慢而贵),简单改动别浪费;effort 按任务难度调档,同一模型也能拉开质量与成本差距。别名 /thinking。", examples: [{ sc: "要啃一个并发竞态的疑难 bug", i: "/effort high", o: "思考强度已切换为 high", e: "强思考适合架构与疑难杂症;修完记得调回低档,不然简单任务也在烧思考 token。" }] },
      { name: "secondary-model", zh: "配置子代理使用的次要模型", detail: "给帮手配便宜模型。为什么:主模型负责决策,子代理干的读文件、跑检索类苦力活用次要模型就够了——重活轻活分开计价,账单立刻好看。别名 /subagent-model。", examples: [{ sc: "主模型是旗舰档,想给子代理换成经济档", i: "/secondary-model", o: "弹出次要模型选择(选择后生效)", e: "子代理产出质量要求低于主线,降档几乎无感;观察几轮任务,输出变糙再调回。" }] },
      { name: "provider", zh: "管理 AI 供应商(添加/删除/刷新)", detail: "多供应商枢纽。为什么:kimi 支持接多家平台,provider 集中添加凭据、刷新状态、删掉不用的——供应商抽风时切一家,活不停。别名 /providers。", examples: [{ sc: "新拿到一家平台的 API key,要接入", i: "/provider", o: "打开供应商管理界面(添加/删除/刷新)", e: "添加后 /model 里就能选到它家的模型。凭据存在本机配置,共用机器用完记得删。" }] },
      { name: "login", zh: "选择平台并完成认证", detail: "配认证。为什么:首次使用、换号、凭据过期都要过 login;选平台走对应授权流程,认证通了才能对话。订阅和 API key 计费方式不同,选对入口。", examples: [{ sc: "刚装好 kimi,要接上自己的账号", i: "/login", o: "弹出平台选择 → 走对应认证流程", e: "认证完成即可开聊。认证失败先查网络代理,再确认账号有没有对应产品权限。" }] },
      { name: "logout", zh: "退出某个已配置的供应商", detail: "回收凭据。为什么:换号、借出机器、走人之前主动 logout,光删配置可能留残留 token。别名 /disconnect;退出后该供应商立即不可用,确认有备用再操作。", examples: [{ sc: "这台共用机器登过我的号,要走了", i: "/logout", o: "选择要退出的供应商 → 已移除认证", e: "凭据立即失效。退出前确认另一家供应商或 key 可用,别把自己锁外面。" }] },
    ] },
    { id: "mode", title: "权限、计划与多智能体", desc: "放权程度你来定:从每步先问到全自动;计划模式先谋后动,多智能体并行作战", commands: [
      { name: "permission", zh: "选择权限模式", detail: "总开关。为什么:agent 能不能直接改文件、跑命令,权限模式说了算;permission 弹出模式选择器,一条命令看清并切换全部档位。/yolo 和 /auto 是两个常用档的快捷直达。", examples: [{ sc: "新项目第一次跑,想先收紧权限看它每步干什么", i: "/permission", o: "弹出权限模式选择器", e: "从「每步先问」到「全自动」按信任度选档。陌生仓库保守起步,混熟了再放权。" }] },
      { name: "yolo", zh: "切到 Ask When Needed 模式(风险动作仍先问)", detail: "平衡档。为什么:例行编辑与常规命令自动跑、不再每步打断你;而危险动作、需要提问和计划仍会征求同意——效率和安全兼得,日常开发默认待在这档。别名 /yes。", examples: [{ sc: "项目已经混熟,嫌每步确认太烦", i: "/yolo", o: "已切换为 Ask When Needed 模式", e: "常规操作丝滑放行,危险动作仍有闸。放心用:它不是无脑全自动,该问的还会问。" }] },
      { name: "auto", zh: "切到 Never Ask 模式(一切自动执行)", detail: "全自动档。为什么:无人值守跑成熟任务(睡前挂批处理、跑长迁移)需要它从不打断,一切自动执行自动决策。风险自担——只对出过错也赔得起的任务用。", examples: [{ sc: "睡前往成熟分支上挂一个批量重构任务", i: "/auto", o: "已切换为 Never Ask 模式", e: "整夜无人值守也能推进。先在白天小规模验证过整条链路,再放它过夜。" }] },
      { name: "plan", zh: "切换计划模式(只读规划)", detail: "先谋后动。为什么:大改动直接动手容易跑偏;plan 模式下 agent 只读代码出方案,不动任何文件,你审完方案再切回来执行。/plan clear 显式清除计划状态。", examples: [{ sc: "要重构认证模块,先要一份不动手的方案", i: "/plan", o: "已进入计划模式(只读规划)", e: "它只读代码、产出计划,改文件的工具全部收起。方案满意退出 plan 模式让它按图施工,跑偏成本大幅降低。" }] },
      { name: "goal", zh: "启动或管理自主目标", detail: "整段目标交给 agent 自主推进:它自己拆步骤、自己干,阻塞时自动暂停,忙完一看进度比想象中远。子命令齐全——status 看进度、pause 暂停、resume 续跑、cancel 作废、replace 换目标、next 跳子步;启动新目标需会话空闲。", usage: "[status|pause|resume|cancel|replace|next] | <objective>", examples: [{ sc: "要把「迁移全部测试到 vitest」整段托管出去", i: "/goal 把仓库测试从 jest 迁移到 vitest,保持全绿", o: "自主目标已启动(agent 开始拆解执行)", e: "它会分批迁移并自验。隔一阵 /goal status 看进度;方向不对 /goal replace 换目标比 cancel 重来省。" }] },
      { name: "swarm", zh: "切换 swarm 模式或把单个任务丢进 swarm", detail: "多代理并行。为什么:一个任务拆得开(逐文件迁移、批量改配置),swarm 放出一群代理分头干,墙钟时间直接除以并行数。/swarm on 常开,/swarm <task> 单发一票。", usage: "[on|off] | <task>", examples: [{ sc: "200 个文件要按同一规则改 import,单代理太慢", i: "/swarm 把 src 下所有组件迁移到新的 import 规范", o: "任务已交给 swarm(多代理并行开工)", e: "并行代理各领一段,互不踩脚。适合机械可拆的任务;需要全局决策的活别拆,拆了各自为政。" }] },
      { name: "tower", zh: "塔式多代理编排(实验特性)", detail: "git worktree 级别的多代理工程:基于一个 base 分支放出一塔代理并行推进,每个代理在自己的 worktree 里干活互不污染。实验开关——需 KIMI_CODE_EXPERIMENTAL_TOWER=1 或 config.toml 的 [experimental] tower = true;teardown 收摊清理。", usage: "[status|teardown|on|off] | <base-branch>", examples: [{ sc: "要在干净基线上并行跑三条独立改动", i: "/tower on main", o: "塔已基于 main 启动(代理在各自 worktree 开工)", e: "worktree 隔离 + 并发预算控制,代理多了会排队。收工 /tower status 核对产出,/tower teardown 清干净现场。" }] },
      { name: "btw", zh: "向分叉的侧问代理提问", detail: "顺手一问不打断主线。为什么:「顺便查一下这个函数谁在调」这种支线问题丢给 btw,它 fork 一份现场去答,答案回来主线上下一根汗毛不动——省得支线琐碎污染主线上下文。", examples: [{ sc: "主线重构到一半,想确认某工具函数还有哪些调用方", i: "/btw 这个 handleRetry 函数还有哪些地方在调用", o: "侧问代理 fork 现场 → 返回答案(主线不受影响)", e: "支线问题都有了专用通道。答案要留档就让它写进主线,否则问完即走,上下文零负担。" }] },
    ] },
    { id: "context", title: "工作区、MCP 与插件", desc: "把项目喂给 agent:多目录、AGENTS.md、MCP 工具与插件生态", commands: [
      { name: "add-dir", zh: "添加或列出额外工作区目录", detail: "跨仓库作战。为什么:改的代码引用了另一个仓库的共享库,不把那目录喂进来,agent 只能对着猜;add-dir 把额外目录挂进工作区。/add-dir list 看已挂了哪些。", usage: "[list] | <path>", examples: [{ sc: "本仓库依赖隔壁的 shared-ui 仓库,要一起改", i: "/add-dir ../shared-ui", o: "已添加额外工作区目录: ../shared-ui", e: "agent 能直接读写隔壁仓库了。用完记得收——挂越多目录,它误改无关代码的面越大。" }] },
      { name: "init", zh: "分析代码库并生成 AGENTS.md", detail: "新项目第一件事。为什么:AGENTS.md 是 agent 的项目说明书(约定、构建命令、目录结构);init 让 agent 自己分析代码库写出初稿,之后每个会话自动遵守,省去反复口头交代。", examples: [{ sc: "刚 clone 一个陌生仓库准备开工", i: "/init", o: "正在分析代码库 → 已生成 AGENTS.md", e: "生成的初稿要人工过一遍补漏(隐性约定它猜不到);写好后再 /reload 立即生效。" }] },
      { name: "mcp", zh: "查看 MCP 服务器状态", detail: "外部工具体检。为什么:配了 MCP 服务器(数据库、浏览器、内部系统)却连不上,第一件事就是 mcp 看状态——哪些在跑、哪些挂了,一屏定位,别翻配置猜。", examples: [{ sc: "agent 说用不了数据库工具,要查 MCP 状态", i: "/mcp", o: "显示 MCP 服务器列表与连接状态", e: "挂了的先看启动命令和凭据;改完 MCP 配置 /reload 重载再验,别重启整个会话。" }] },
      { name: "plugins", zh: "管理插件", detail: "能力扩展入口。为什么:MCP 之外,kimi 还能装插件加命令加工具;plugins 打开管理界面,装什么、卸什么、看状态都在这。装第三方插件前读它的说明——它以你的名义干活。", examples: [{ sc: "想看看 kimi 都能装什么扩展", i: "/plugins", o: "打开插件管理界面", e: "浏览已装与可装插件;不用的及时卸,插件越多启动与上下文开销越大。" }] },
      { name: "reload", zh: "重载会话并应用 config.toml 与 tui.toml", detail: "配置热生效。为什么:改了 AGENTS.md、config.toml 或 tui.toml,重启会话太重;reload 全量重载,配置秒级生效,调配置必备。行为诡异时重启一次兜底。", examples: [{ sc: "刚往 AGENTS.md 补了一条代码规范,要立即生效", i: "/reload", o: "已重载配置(config.toml 与 tui.toml 均生效)", e: "不用开新会话,规范即刻约束 agent。若重载后行为不对劲,开新会话排除有状态残留。" }] },
      { name: "reload-tui", zh: "仅重载 tui.toml 界面偏好", detail: "轻量重载。为什么:只调了界面偏好(主题细节、显示选项),不想动会话配置;reload-tui 只重载 UI 层,更快也更稳——调界面的专用通道。", examples: [{ sc: "刚改了 tui.toml 里的一处显示偏好", i: "/reload-tui", o: "tui.toml 界面偏好已重载", e: "界面立即刷新,会话上下文与配置不受影响。只动了 UI 就用它,别全量 reload 白折腾。" }] },
    ] },
    { id: "config", title: "定制与日常维护", desc: "把 kimi 调成自己的:设置、主题、编辑器与版本维护", commands: [
      { name: "settings", zh: "打开 TUI 设置", detail: "设置入口。为什么:界面行为、默认值这些一次性配置,配完就忘;settings 菜单集中管理,不用翻 config.toml 找字段。别名 /config。", examples: [{ sc: "想看看 kimi 都能配什么", i: "/settings", o: "打开 TUI 设置菜单(分类浏览)", e: "逐项过一遍配成顺手;多数设置即时生效,不满意再进来改回。" }] },
      { name: "experiments", zh: "管理实验特性", detail: "实验开关面板。为什么:tower 这类新特性先以实验态发布,experiments 一屏列出可开关的实验项,尝鲜和回退都在这;稳定后官方会转正式。别名 /experimental。", examples: [{ sc: "想开 tower 实验但不想改 config.toml", i: "/experiments", o: "打开实验特性管理界面", e: "界面里直接开关,比手改配置快。实验特性行为可能变,生产重活别依赖。" }] },
      { name: "editor", zh: "设置 Ctrl-G 调用的外部编辑器", detail: "长文本的去处。为什么:在终端小输入框里写长 prompt 是酷刑;配好外部编辑器后 Ctrl-G 一键跳到熟悉的编辑器里写,保存即回填——写长任务描述的体验分水岭。", examples: [{ sc: "要用 vim 写长 prompt,不想在小输入框里受罪", i: "/editor vim", o: "外部编辑器已设置为 vim", e: "之后输入框按 Ctrl-G 即进入 vim 编辑,保存退出自动回填。选自己肌肉记忆最深的那个。" }] },
      { name: "theme", zh: "设置终端 UI 主题", detail: "换肤。为什么:每天盯几小时的界面,配色舒服不是矫情;theme 切换内置主题,配合终端自身的配色方案调到最顺眼。", examples: [{ sc: "夜里干活嫌默认主题太亮", i: "/theme", o: "弹出主题选择(选中即生效)", e: "选深色护眼;终端本身也要配套深色配色,不然半深半浅更难受。" }] },
      { name: "help", zh: "显示可用命令与快捷键", detail: "随身说明书。为什么:43 条命令不用背,help 一屏列全;忘了某条叫什么、快捷键怎么按,先 help 再猜。别名 /h 和 /?。", examples: [{ sc: "记得有撤回命令,忘了叫什么", i: "/help", o: "显示全部命令与快捷键列表", e: "按需即查;每周扫一遍总有没发现过的能力,效率上限就藏在这里。" }] },
      { name: "version", zh: "显示版本信息", detail: "版本核对。为什么:报 bug、查更新日志、确认团队版本一致,第一步都是 version——「我这是好的」和「你版本多少」的争论,一条命令终结。", examples: [{ sc: "怀疑行为和文档不符,先核对版本", i: "/version", o: "显示 kimi 版本信息", e: "对着官方 changelog 看是不是已知变更;旧版本先升级再报问题。" }] },
      { name: "feedback", zh: "向 Kimi Code 反馈问题", detail: "直通官方。为什么:撞到 bug 或有好点子,feedback 直接把反馈送到 Kimi Code 团队;比去仓库开 issue 轻量,顺手就报。别名 /bug。", examples: [{ sc: "agent 反复在某类文件上误操作", i: "/feedback 在嵌套 monorepo 里 glob 时常漏掉子包文件", o: "反馈已提交,感谢你的帮助", e: "描述带上复现步骤最好;同类问题先 /export-debug-zip 打包,材料齐全官方修得快。" }] },
    ] },
    { id: "share", title: "状态、用量与成果出口", desc: "看住消耗、带走成果:状态与配额一眼清,导出与远程一条龙", commands: [
      { name: "status", zh: "查看当前会话与运行时状态", detail: "会话档案。为什么:「现在什么模式、跑的哪个模型、挂了哪些目录」一条命令看全;排查「它为什么这么做」先看 status,多半是模式和配置和你以为的不一样。", examples: [{ sc: "agent 行为反常,想确认当前模式与模型", i: "/status", o: "显示会话与运行时状态(模式 · 模型 · 工作区)", e: "数字和模式对不上直觉时先纠偏再干活。跨会话汇总看 tmd-cli 侧栏的会话管理面。" }] },
      { name: "usage", zh: "查看 token、上下文窗口与套餐配额", detail: "看住油表。为什么:回复变慢变贵,八成是上下文快满或配额见底;usage 把 token 消耗、窗口占用、套餐余量一次摆清——该 /compact 还是省着用,数据说了算。", examples: [{ sc: "长会话跑了一上午,想看看还剩多少空间", i: "/usage", o: "显示 token 用量 · 上下文窗口占用 · 套餐配额", e: "窗口占用过半就考虑 /compact;配额见底先切次要模型或等重置,别等它硬报错。" }] },
      { name: "tasks", zh: "浏览后台任务", detail: "后台工单板。为什么:丢给后台跑的任务(goal、swarm 分片)不能靠猜;tasks 列出全部后台任务与状态,谁在跑、谁完成、谁失败一目了然。别名 /task。", examples: [{ sc: "刚才发了几个后台任务,回来查进度", i: "/tasks", o: "列出后台任务及状态", e: "完成的领走产出,失败的看原因重发。后台任务堆积会抢资源,干完一批清一批。" }] },
      { name: "copy", zh: "复制最近一条助手消息到剪贴板", detail: "一键带走。为什么:「把刚才那段方案发我」——滚屏手选容易断行错乱;copy 直取最近一条助手消息全文,干净利落。", examples: [{ sc: "agent 刚给出完整修复方案,要贴给同事", i: "/copy", o: "最近一条助手消息已复制到剪贴板", e: "全文在剪贴板直接粘贴。连续多轮输出时确认最新一条就是你要的那条;更早的用 /export-md 全量导。" }] },
      { name: "export-md", zh: "把当前会话导出为 Markdown 文件", detail: "成果出仓。为什么:决策过程与排查思路都有交接价值;export-md 导出标准 Markdown,进 wiki、发同事、贴文档即读即用。别名 /export。含敏感内容导出前掂量传播范围。", examples: [{ sc: "这次线上事故的排查过程要写进复盘文档", i: "/export-md incident-review.md", o: "会话已导出为 Markdown 文件", e: "拿到的是可编辑的 md,掐头去尾就能归档。要给同事继续跑的现场,markdown 不行——那是记录不是现场。" }] },
      { name: "export-debug-zip", zh: "导出当前会话的调试 ZIP 包", detail: "报障快递盒。为什么:官方修 bug 要完整现场——会话记录、环境信息、版本号;debug zip 一次打包齐, /feedback 配套动作,材料全问题修得快。", examples: [{ sc: "撞到一个可稳定复现的 bug,要报给官方", i: "/export-debug-zip", o: "调试包已导出(含会话记录与环境信息)", e: "打包内容可能含代码片段与路径,发给官方前扫一眼有没有敏感信息。" }] },
      { name: "web", zh: "启动服务器并在 Web UI 打开当前会话", detail: "终端会话上浏览器。为什么:手机或别的机器上看一眼跑着的会话、贴个链接给同事同看;web 起一个本地服务器,把当前会话原样搬进浏览器。", examples: [{ sc: "会话在跑长任务,想去沙发上用平板盯进度", i: "/web", o: "已启动服务器并给出 Web UI 地址", e: "浏览器打开同地址即可看同一会话。服务是本机起的,用完记得停,别把会话挂公网。" }] },
      { name: "desktop", zh: "在浏览器打开 Kimi Code 桌面版页面", detail: "升级入口。为什么:终端之外官方还有桌面版;desktop 直接打开产品页面,想换更强的图形界面时省去找地址的功夫。别名 /install-desktop。", examples: [{ sc: "听说 kimi 出了桌面版,想看看长什么样", i: "/desktop", o: "已在浏览器打开 Kimi Code 桌面版页面", e: "页面里有下载与介绍;终端版与桌面版配置互通,按习惯选阵地。" }] },
      { name: "remote-control", zh: "通过 Kimi Remote Control 打开当前会话", detail: "远程遥控。为什么:人不在电脑前也要推进任务——remote-control 把当前会话接到 Kimi 的远程通道,手机上就能看进度、发指令。别名 /rc。", examples: [{ sc: "出门吃饭,想让会话继续跑并随时能插手", i: "/remote-control", o: "已通过 Kimi Remote Control 打开当前会话", e: "远程与本地同一会话,指令双向生效。公共网络下注意通道安全,回来后本地接着用。" }] },
    ] },
  ],
  lessons: KIMI_ACADEMY_LESSONS,
};
