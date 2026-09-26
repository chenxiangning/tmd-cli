/**
 * grok 学堂课程 —— 7 课覆盖全部 5 章,首课欢迎/末课结业速查。
 * 内容与 academyCatalog.ts 同源纪律(见其头注);chapter 指向目录章节 id。
 */
import type { AcademyCourse } from "@kernel/academy";

type Lesson = AcademyCourse["lessons"][number];

export const GROK_ACADEMY_LESSONS: Lesson[] = [
  { id: "welcome", title: "grok 是什么", sub: "1 分钟", goal: "grok 是 xAI 的终端编程 agent:自然语言下指令,它读代码、改文件、跑命令,还会生图生视频。学完这课你会发出第一条指令。", points: ["直接打字描述任务,回车发送——不需要任何命令也能干活", "斜杠 <b>/</b> 开头的是会话内命令,管理会话、上下文、扩展这些「工具箱」本身", "grok <prompt>、grok login 这类顶层命令在普通终端跑;学堂里以 <b>grok</b> 前缀标注", "本学堂 5 章 31 条命令;先混个脸熟,用到了再回来查"], demo: [["你好,帮我看看这个仓库的结构", "agent 开始读目录并给出概览(直接对话即可,无需命令)"]], practice: "/help", practiceWhy: "打开命令总表,看看 grok 都有哪些能力,混个脸熟。" },
  { id: "start", title: "启动与账号", sub: "约 2 分钟", goal: "在终端里配好登录、查模型、做体检。这几条顶层命令是第一天就要会的地基。", chapter: "start", points: ["<b>grok login</b> 登录;远程机器加 --device-auth 走设备码", "<b>grok models</b> 列出账号可用模型与准确 ID", "<b>grok doctor</b> 体检终端/剪贴板;SSH 复制不灵按提示 doctor fix", "<b>grok update</b> 检查更新或装指定版本回滚"], demo: [["grok login", "浏览器打开授权页(或 --device-auth 出设备码)"], ["grok models", "逐行列出模型 ID 与描述"]], practice: "grok doctor", practiceWhy: "跑一次体检,确认当前终端的剪贴板/颜色/输入都正常。" },
  { id: "sessions", title: "会话:找回、翻页与分身", sub: "约 3 分钟", goal: "会话是你和 agent 的连续工作现场。学完这课你会:找回、回退、分身并行、看档案。", chapter: "sessions", points: ["<b>/resume</b> 找回历史会话;tmd-cli 侧栏 grok 分组点一下等效", "<b>/rewind</b> 回退到某一轮重跑;文件改动自己用 git 兜", "<b>/fork --worktree</b> 分身独立工作树,两条方案并行不踩脚", "<b>/session-info</b> 看模型与上下文;<b>grok sessions</b> 终端侧列/搜会话"], demo: [["/resume", "弹出会话选择器"], ["/fork --worktree 试试方案 B", "新分身会话已建立(带独立 worktree)"], ["/session-info", "模型 · 上下文 · 路径"]], practice: "/resume", practiceWhy: "找回一个历史会话,体会恢复的是完整现场。" },
  { id: "context", title: "上下文与规划", sub: "约 2 分钟", goal: "大活先规划,长了会压缩——学会这两招,grok 又省又稳。", chapter: "context", points: ["<b>/plan 描述</b> 先出方案不动文件,确认后再执行,砍掉大半返工", "<b>/compact</b> 上下文见长就压缩;重要细节先落文档再压", "<b>/find</b> 搜会话内容,<b>/jump</b> 跳到某一轮,<b>/history</b> 搜你发过的 prompt", "<b>/usage show</b> 看计费口径的花费"], demo: [["/plan 重构支付模块,先出迁移方案", "进入规划模式,只读代码产出方案"], ["/compact", "历史压成摘要,上下文腾出空间"]], practice: "/plan", practiceWhy: "随便挑个小任务走一遍规划流程,体会先想后做的节奏。" },
  { id: "extend", title: "扩展:工具接入与自动化", sub: "约 3 分钟", goal: "MCP 挂外部工具、插件与 agent 定义扩能力,/loop /workflow 让固定活自己跑。", chapter: "extend", points: ["<b>/mcps</b> 看连接状态;<b>grok mcp add</b> 挂新工具(stdio 用 -- 分隔,远程 --transport)", "<b>/plugins</b> 管插件;来源不明先读代码再信任", "<b>/config-agents</b> 管子代理定义;<b>/hooks add</b> 挂事件钩子(重启会话生效)", "<b>/loop 10m 任务</b> 定时值守;<b>/workflow 名字</b> 一键跑保存的流程"], demo: [["/mcps", "列出各 MCP 服务器与连接状态"], ["/loop 10m 跑一遍测试,红了就报告原因", "循环任务已建立"]], practice: "/mcps", practiceWhy: "看看当前配了哪些 MCP 工具、连接状态如何。" },
  { id: "extras", title: "多媒体、文档与日常", sub: "约 2 分钟", goal: "生图生视频、深度调研、查文档——把 grok 的加分项用起来,日常维护不掉链。", chapter: "extras", points: ["<b>/imagine</b> 文生图,<b>/imagine-video</b> 文生视频;描述越具体越稳", "<b>/deep-research 问题</b> 多轮自动调研,值得认真回答的问题才用", "<b>/docs</b> 直达官方文档;<b>/release-notes</b> 升级后扫一眼", "<b>/help</b> 命令总表,<b>/quit</b> 收工退出(值守任务先停)"], demo: [["/imagine 极简风格的终端窗口插画", "生成图片并在会话中展示"], ["/release-notes", "显示当前版本更新条目"]], practice: "/help", practiceWhy: "再过一遍命令总表,这节课的命令都在里面。" },
  { id: "graduation", title: "结业:速查表与下一步", sub: "1 分钟", goal: "全部章节过完。这张卡是每章最常用命令;完整指南在左栏学堂菜单里随时可查。", points: [], cheat: true },
];
