/**
 * codex 学堂入门课 —— 7 课覆盖全部 5 章,首课欢迎/末课结业速查。
 * 内容与 academyCatalog.ts 同源纪律(见其头注);chapter 指向目录章节 id。
 */
import type { AcademyCourse } from "@kernel/academy";

type Lesson = AcademyCourse["lessons"][number];

export const CODEX_ACADEMY_LESSONS: Lesson[] = [
  { id: "welcome", title: "codex 是什么", sub: "1 分钟", goal: "codex 是跑在终端里的编程 agent:你用自然语言下指令,它读代码、改文件、跑命令。学完这课你会发出第一条指令并看懂仪表盘。", points: ["直接打字描述任务,回车发送——不需要任何命令也能干活", "斜杠 <b>/</b> 开头的是命令,管理模型、权限、上下文这些「工具箱」本身", "<b>$</b> 提技能、<b>@</b> 引文件,三大触发符各管一摊", "本学堂 5 章 29 条核心命令;先混个脸熟,用到了再回来查"], demo: [["帮我看看这个仓库的结构", "agent 开始读目录并给出概览(直接对话即可,无需命令)"], ["/status", "模型 · 审批策略 · token 用量一览"]], practice: "/status", practiceWhy: "学会看仪表盘:模型、审批、用量,后面的课程全围绕它展开。" },
  { id: "sessions", title: "会话:开始、找回与整理", sub: "约 2 分钟", goal: "会话是你和 agent 的连续工作现场。学完这课你会:开新对话、找回旧的、分叉试错、归档整理。", chapter: "sessions", points: ["<b>/new</b> 换任务先开新对话,旧的完整留盘", "<b>/resume</b> 找回历史对话,带关键词可直取;tmd-cli 侧栏点历史会话等效", "<b>/fork</b> 复制现场分头试错;<b>/archive</b> 做完的活归档", "<b>/rename</b> 起名趁早,一周后不抓瞎"], demo: [["/new", "新对话已开始"], ["/rename 支付回调重构", "对话已改名:支付回调重构"], ["/resume", "弹出历史对话选择器"]], practice: "/rename 我的第一次对话", practiceWhy: "体会命名对未来找回的价值。" },
  { id: "context", title: "上下文与信息", sub: "约 3 分钟", goal: "上下文是预算:会压缩、会查账、会引文件,长任务才跑得动;diff 和导出让成果出得了门。", chapter: "context", points: ["<b>/compact</b> 上下文见长就压缩,防撞上限", "<b>/status</b> 看会话仪表盘,<b>/usage</b> 看账号限额", "<b>/diff</b> 验收它改了什么,提交前必过", "<b>/mention</b> 精确引用文件(@ 触发符等效);<b>/export</b> 出 markdown 复盘"], demo: [["/compact", "对话已压缩为摘要"], ["/diff", "显示全部改动(含未跟踪文件)"], ["/usage", "账号用量与限额重置时间"]], practice: "/diff", practiceWhy: "看看当前工作区有什么改动,养成验收先看 diff 的纪律。" },
  { id: "guide", title: "引导与审查", sub: "约 3 分钟", goal: "开局教它规矩,收尾让它自检:init 钉项目规矩,review 加自检闸门,plan 先谋后动,goal 钉住长任务。", chapter: "guide", points: ["<b>/init</b> 生成 AGENTS.md 初稿,人工审改后才算数", "<b>/review 重点</b> 让它以审查者视角再过一遍你的改动", "<b>/plan</b> 大活先出方案再动手,方向错误在纸面上截住", "<b>/goal</b> 给长任务钉北极星,edit 更新、clear 收尾"], demo: [["/init", "生成 AGENTS.md(含项目结构与命令初稿)"], ["/review 重点看并发安全", "输出问题清单(按严重度)"]], practice: "/review", practiceWhy: "对当前改动跑一轮评审,看看它能抓出什么你漏掉的问题。" },
  { id: "config", title: "模型与配置", sub: "约 3 分钟", goal: "模型定智商,权限定边界:会切模型、会调审批档位、会盘点工具箱,把 codex 调成你的安全区。", chapter: "config", points: ["<b>/model</b> 一个选择器同时定模型与推理力度;composer 模型 pill 等效", "<b>/permissions</b> 审批档位是安全边界,陌生仓库只读起步", "<b>/mcp verbose</b> 盘点 MCP 工具;<b>/skills</b> 查看技能($ 触发符直调)", "<b>/vim</b> 输入框模态编辑;<b>/logout、/quit</b> 收工退干净"], demo: [["/model", "弹出模型与推理力度选择器"], ["/permissions", "弹出权限档位选择器"], ["/mcp verbose", "列出 MCP server 与工具"]], practice: "/model", practiceWhy: "打开选择器看看你有哪些模型和推理档位,记住 composer 的模型 pill。" },
  { id: "parallel", title: "后台与并行", sub: "约 2 分钟", goal: "多线作战面:子代理指挥中心、侧聊支线、worktree 物理隔离、后台终端盘点。", chapter: "parallel", points: ["<b>/agents</b> 多代理并行时的指挥中枢,进度与干预都在这", "<b>/side</b> 主线跑着开支线问小问题,上下文零污染(/btw 同款)", "<b>/worktree</b> 大改在独立工作目录里折腾,主线不踩脚", "<b>/ps</b> 盘点后台终端;收工先 /ps 后 /stop 清场"], demo: [["/agents", "打开代理指挥中心"], ["/ps", "列出后台终端及其状态"]], practice: "/ps", practiceWhy: "看看现在有哪些后台终端在跑,顺便记住 /stop 是清场开关。" },
  { id: "graduation", title: "结业:速查表与下一步", sub: "1 分钟", goal: "全部章节过完。这张卡是每章最常用命令;完整指南在左栏学堂菜单里随时可查。", points: [], cheat: true },
];
