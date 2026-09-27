/**
 * opencode 学堂入门课 —— 8 课覆盖全部 6 章,首课欢迎/末课结业速查。
 * 内容与 academyCatalog.ts 同源纪律(见其头注);chapter 指向目录章节 id。
 */
import type { AcademyCourse } from "@kernel/academy";

type Lesson = AcademyCourse["lessons"][number];

export const OPENCODE_ACADEMY_LESSONS: Lesson[] = [
  { id: "welcome", title: "opencode 是什么", sub: "1 分钟", goal: "opencode 是跑在终端里的开源编程 agent:你用自然语言下指令,它读代码、改文件、跑命令,模型供应商随意搭配。学完这课你会发出第一条指令。", points: ["直接打字描述任务,回车发送——不需要任何命令也能干活", "斜杠 <b>/</b> 开头的是命令,负责管理会话、模型、上下文这些「工具箱」本身", "本学堂 6 章 29 条命令;先混个脸熟,用到了再回来查"], demo: [["你好,帮我看看这个仓库的结构", "agent 开始读目录并给出概览(直接对话即可,无需命令)"]], practice: "/models", practiceWhy: "打开模型选择器看看你有哪些模型可用,这是 opencode 的第一件行李。" },
  { id: "sessions", title: "会话:开始、找回与命名", sub: "约 2 分钟", goal: "会话是你和 agent 的连续工作现场。学完这课你会:开新会话、找回旧的、认名、跨目录搬家。", chapter: "sessions", points: ["<b>/new</b> 换任务先开新会话,旧的完整留盘(别名 /clear)", "<b>/sessions</b> 列表选中即恢复现场;tmd-cli 侧栏点开会话等效", "<b>/rename</b> 起名趁早,一周后不抓瞎", "<b>/move</b> 会话连上下文搬到另一个项目目录"], demo: [["/new", "新会话已开始"], ["/rename 支付回调重构", "会话已改名:支付回调重构"], ["/sessions", "弹出会话列表(选中即切换)"]], practice: "/rename opencode 初体验", practiceWhy: "体会命名对未来找回的价值。" },
  { id: "model", title: "模型、agent 与供应商", sub: "约 3 分钟", goal: "会切模型、会换 agent、会配凭据。模型决定智商与花费,agent 决定行为边界,这两个第二天就要会。", chapter: "model", points: ["<b>/models</b> 弹选择器切模型(别名 /mo),切换不影响已有上下文", "<b>/agents</b> 切行为模式:写代码用 build,只读规划用 plan", "<b>/variants</b> 在当前模型的思考档位间轮换;<b>/mcps</b> 按需开关 MCP 工具", "<b>/connect</b> 配供应商凭据,连不上模型先回来查它"], demo: [["/models", "弹出模型选择器(Enter 切换)"], ["/agents", "弹出 agent 选择器(选中即切换)"], ["/mcps", "弹出 MCP 服务器开关列表"]], practice: "/models", practiceWhy: "浏览一遍可用模型,记住常用两三个的位置。" },
  { id: "context", title: "上下文与分支:续命术与试错保险", sub: "约 3 分钟", goal: "学会 compact 的长任务续命、undo/redo 的反悔机制、fork 与 timeline 的分叉回看——这是 opencode 用出高级感的关键。", chapter: "context", points: ["<b>/compact</b> 上下文见长就压缩(别名 /summarize);重要约定先落文件再压", "<b>/undo</b> 消息连同文件改动一起回退;<b>/redo</b> 再反悔回来", "<b>/fork</b> 从历史消息分叉,两条路线并行试", "<b>/timeline</b> 消息地图,长会话的检索入口"], demo: [["/compact", "Session compacted"], ["/undo", "上一条消息与其文件改动已回退"], ["/timeline", "弹出消息时间线(选中即跳转)"]], practice: "/timeline", practiceWhy: "回头找一条早先的消息,体会长会话里它比滚屏快多少。" },
  { id: "share", title: "分享与导出", sub: "约 2 分钟", goal: "成果出得了门:远程分享链接、一键复制全文、导出成文档——以及分享后的反悔药。", chapter: "share", points: ["<b>/share</b> 生成分享链接;链接即权限,内容先掂量", "<b>/unshare</b> 让链接立即失效,分享后的反悔药", "<b>/copy</b> 整场会话记录进剪贴板,贴工单发同事一步到位", "<b>/export</b> 会话送进 $EDITOR 整理成文"], demo: [["/share", "Session shared(链接已生成)"], ["/copy", "Copied to clipboard"], ["/export", "会话记录已在编辑器中打开"]], practice: "/copy", practiceWhy: "把当前会话复制到剪贴板贴进任意编辑器,看看出门前的最后检查点。" },
  { id: "view", title: "视图与排查", sub: "约 2 分钟", goal: "看清终端里发生的一切:思考块、时间戳、diff 审查、状态与调试信息。", chapter: "view", points: ["<b>/thinking</b> 展开收起思考块,看推理还是看结论随你切", "<b>/diff</b> agent 改完必看 diff——信任但验证", "<b>/timestamps</b> 核对执行耗时;<b>/status</b> 先看状态再猜问题", "<b>/themes</b> 换主题,以 diff 可读为准"], demo: [["/thinking", "思考块已收起(再执行一次展开)"], ["/diff", "打开 diff 查看器(列出全部改动)"], ["/status", "显示当前状态信息"]], practice: "/themes", practiceWhy: "换一个主题感受 diff 与高亮可读性,选一个顺手的定下来。" },
  { id: "tools", title: "效率与收尾", sub: "约 2 分钟", goal: "长消息用外编辑器写,常用流程沉淀为技能,离场收尾干净。", chapter: "tools", points: ["<b>/editor</b> 几十行的需求描述跳进 $EDITOR 写,保存即回会话", "<b>/skills</b> 盘点项目沉淀的流程包,选中即套用,别重复手打长 prompt", "<b>/help</b> 记不清命令时的一屏答案;<b>/exit</b>(别名 /quit、/q)收工离场"], demo: [["/editor", "打开外部编辑器($EDITOR)"], ["/skills", "弹出技能浏览面板"], ["/exit", "opencode 退出(会话已保存)"]], practice: "/help", practiceWhy: "过一遍帮助里的命令总表,对照本学堂看还有哪条没见过。" },
  { id: "graduation", title: "结业:速查表与下一步", sub: "1 分钟", goal: "全部章节过完。这张卡是每章最常用命令;完整指南在左栏学堂菜单里随时可查。", points: [], cheat: true },
];
