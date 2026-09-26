/**
 * dsh 学堂入门课 —— 5 课覆盖全部 3 章,首课欢迎/末课结业速查。
 * 内容与 academyCatalog.ts 同源纪律(见其头注);chapter 指向目录章节 id。
 */
import type { AcademyCourse } from "@kernel/academy";

type Lesson = AcademyCourse["lessons"][number];

export const DSH_ACADEMY_LESSONS: Lesson[] = [
  { id: "welcome", title: "dsh 是什么", sub: "1 分钟", goal: "dsh 是 DeepSeek 官方的编程 agent:你用自然语言下指令,它读代码、改文件、跑命令。学完这课你会发出第一条指令。", points: ["直接打字描述任务,回车发送——不需要任何命令也能干活", "斜杠 <b>/</b> 开头的是命令,负责管模型、权限、计划这些「工具箱」本身", "本学堂 3 章 7 条命令;dsh 命令面小而精,每一条都值得过一遍"], demo: [["你好,帮我看看这个仓库的结构", "agent 开始读目录并给出概览(直接对话即可,无需命令)"]], practice: "/model", practiceWhy: "打开模型菜单,看看有哪些模型与推理等级,记住 composer 旁的模型 pill。" },
  { id: "model-perm", title: "模型与权限", sub: "约 2 分钟", goal: "会选模型、会管推理等级、会切权限预设。模型决定智商与花费,权限决定它敢不敢动手。", chapter: "model-perm", points: ["<b>/model</b> 弹「模型与推理等级」菜单:v4-flash 省钱跑常规,v4-pro 打硬仗", "推理等级(effort)在同一菜单里调:档位越高想得越深,也越慢越贵", "<b>/permission</b> 切权限预设:workspace-write 是日常,越界操作弹审批兜底", "danger-full-access 沙箱全开不再询问——只给可信仓库的放手任务用"], demo: [["/model", "弹出「模型与推理等级」菜单"], ["/permission", "current preset workspace-write(available: workspace-write, danger-full-access)"]], practice: "/permission", practiceWhy: "先看清当前会话的权限档位,再决定要不要切换。" },
  { id: "plan-goal", title: "计划与长任务", sub: "约 2 分钟", goal: "学会用 plan 模式先规划后动手,用 goal 把长任务目标钉在会话上——这是 dsh 干大活的骨架。", chapter: "plan-goal", points: ["<b>/plan</b> 进入计划模式:agent 只读代码只出方案,确认后才落地", "<b>/plan 一句话</b> 带着任务去调研;<b>/plan off</b> 退出恢复执行", "<b>/goal 目标</b> 把长任务目标持久钉住,断线、压缩、隔天续跑都不丢方向", "<b>/goal pause|resume|edit|clear</b> 歇刀、续跑、改目标、收尾"], demo: [["/plan 把认证从 session 迁到 token,先出方案", "Plan mode on. Use /plan off to leave."], ["/goal 把 orders 表按月拆分迁移,并校验行数一致", "Goal created"]], practice: "/goal 读一遍本仓库 README,产出一份上手笔记", practiceWhy: "体会把任务钉成目标:之后每轮 agent 都会锚定它,不怕长任务跑散。" },
  { id: "session-care", title: "上下文与产物", sub: "约 2 分钟", goal: "会话长了会续命,成果能打包出门;顺手把使用反馈递给 DeepSeek。", chapter: "session-care", points: ["<b>/compact</b> 把旧历史压成摘要腾空间;压力过大时 dsh 也会自动压", "压缩有损:关键约束提前写进 /goal 或文档,别赌摘要全记得", "<b>/export</b> 完整会话日志打包 ZIP,浏览器直接下载", "<b>/feedback 具体现象</b> 反馈直通车;写清复现路径才有用"], demo: [["/compact", "会话开始压缩并产出摘要"], ["/export", "Session log download requested.(浏览器开始下载 ZIP)"]], practice: "/compact", practiceWhy: "看看当前会话压缩后轻快了多少;压之前先把重要约束钉进 goal。" },
  { id: "graduation", title: "结业:速查表与下一步", sub: "1 分钟", goal: "全部章节过完。这张卡是每章全部命令;dsh 的命令面就这 7 条,用熟即是熟手。", points: [], cheat: true },
];
