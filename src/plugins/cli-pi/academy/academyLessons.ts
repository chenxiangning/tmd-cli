/**
 * pi 学堂入门课 —— 7 课覆盖全部 5 章,首课欢迎/末课结业速查。
 * 内容与 academyCatalog.ts 同源纪律(见其头注);chapter 指向目录章节 id。
 */
import type { AcademyCourse } from "@kernel/academy";

type Lesson = AcademyCourse["lessons"][number];

export const PI_ACADEMY_LESSONS: Lesson[] = [
  { id: "welcome", title: "pi 是什么", sub: "1 分钟", goal: "pi 是跑在终端里的编程 agent:你用自然语言下指令,它读代码、改文件、跑命令。学完这课你会发出第一条指令。", points: ["直接打字描述任务,回车发送——不需要任何命令也能干活", "斜杠 <b>/</b> 开头的是命令,负责管理会话、模型、上下文这些「工具箱」本身", "本学堂 5 章 23 条命令;先混个脸熟,用到了再回来查"], demo: [["你好,帮我看看这个仓库的结构", "agent 开始读目录并给出概览(直接对话即可,无需命令)"]], practice: "/name 我的第一次对话", practiceWhy: "给会话起个一眼能认的名字,一周后 /resume 不抓瞎。" },
  { id: "sessions", title: "会话:开始、找回与命名", sub: "约 2 分钟", goal: "会话是你和 agent 的连续工作现场。学完这课你会:开新会话、找回旧的、认名、看档案。", chapter: "sessions", points: ["<b>/new</b> 换任务先开新会话,旧的完整留盘", "<b>/resume</b> 找回历史会话;tmd-cli 侧栏 pi 分组点一下等效", "<b>/name</b> 起名趁早,一周后不抓瞎", "<b>/session</b> 看当前会话的模型/token/文件路径"], demo: [["/new", "新会话已开始"], ["/name 支付回调重构", "会话已命名:支付回调重构"], ["/session", "模型 · 消息数 · token · 会话文件路径"]], practice: "/name 我的第一次对话", practiceWhy: "体会命名对未来找回的价值。" },
  { id: "model", title: "模型与账号", sub: "约 2 分钟", goal: "会切模型、会配认证。模型决定智商与花费,这两个命令第二天就要会。", chapter: "model", points: ["<b>/model</b> 弹选择器;带 <b>/model 提供方/模型名</b> 精确命中直接切;composer 模型 pill 等效", "<b>/scoped-models</b> 把常用模型圈进 Ctrl+P 快切清单", "<b>/login</b> 配认证:订阅走 OAuth,API key 按量计费——选错方式直接影响账单", "<b>/settings</b> 主题/默认模型等一次性配置都在这"], demo: [["/model", "弹出模型选择器(Enter 切换)"], ["/scoped-models", "勾选常用模型 → Ctrl+P 轮换"]], practice: "/model", practiceWhy: "打开选择器看看你有哪些模型,记住 composer 的模型 pill。" },
  { id: "branch", title: "分支与上下文:试错保险与续命术", sub: "约 3 分钟", goal: "学会 fork/clone/tree 的试错保险,和 compact 的长任务续命——这是 pi 用出高级感的关键。", chapter: "branch", points: ["<b>/clone</b> 危险操作前原地复制一份,搞砸了切回本体", "<b>/fork</b> 弹选择器选历史消息分叉,两条路线并行试", "<b>/tree</b> 分支地图,选中即切换", "<b>/compact 保留指示</b> 上下文见长就压缩;关键约束写进指示才保得住"], demo: [["/clone", "Cloned to new session"], ["/compact 保留接口签名与文件清单", "Session compacted 1 times"]], practice: "/compact", practiceWhy: "看看当前会话压缩后精简了多少,体会保留指示的写法。" },
  { id: "share", title: "分享与导出", sub: "约 2 分钟", goal: "成果出得了门:发人能读的 HTML、给能继续的 JSONL、一键复制、远程 gist。", chapter: "share", points: ["<b>/export</b> 默认 HTML 发人即读;<b>.jsonl</b> 后缀导出可 /import 的现场备份", "<b>/share</b> GitHub secret gist,远程即看;链接即权限,内容先掂量", "<b>/copy</b> 最近一条 agent 消息进剪贴板,告别滚屏手选"], demo: [["/export", "Session exported to: <路径>.html"], ["/copy", "Copied last agent message to clipboard"]], practice: "/export", practiceWhy: "把当前会话导出一个 HTML,发给朋友看看你的工作流。" },
  { id: "custom", title: "定制、技能与维护", sub: "约 2 分钟", goal: "把 pi 调成自己的:热重载配置、项目信任、技能调用与日常维护。", chapter: "custom", points: ["<b>/reload</b> 改了 AGENTS.md/技能/键位后秒级生效,不用重启", "<b>/trust</b> 自己的项目存信任;陌生仓库先读它的指令文件再信任", "<b>/skill:名称</b> 一键调用技能(预制提示词工程包),参数空格接尾部", "<b>/changelog</b> 升级后扫一眼;<b>/hotkeys</b> 每周扫一遍快捷键"], demo: [["/reload", "配置已重载"], ["/skill:code-review 重点看并发安全", "技能展开为提示词发送"]], practice: "/hotkeys", practiceWhy: "过一遍快捷键总表,挑一个明天就开始用。" },
  { id: "graduation", title: "结业:速查表与下一步", sub: "1 分钟", goal: "全部章节过完。这张卡是每章最常用命令;完整指南在左栏学堂菜单里随时可查。", points: [], cheat: true },
];
