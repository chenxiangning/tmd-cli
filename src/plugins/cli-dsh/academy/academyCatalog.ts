/**
 * dsh 学堂课程目录 —— DeepSeek Harness 0.1.5-rc.1 全部 7 条注册斜杠命令(3 章)。
 *
 * 真源与提取法:@deepseek-ai/dsh 0.1.5-rc.1 包内 lib/*.js 直读注册表——
 * dsh-command-compact / dsh-command-goal / dsh-command-feedback /
 * dsh-permission-presets / dsh-session-log-export / dsh-plan-mode /
 * dsh-client-ui-model-selection 七个子包的 commands.register /
 * command.register 调用点(命令名+官方描述+usage hint),并逐条对过
 * handler 真实行为:/goal 子命令集、/plan off 退出语义、/permission 预设表
 * (workspace-write / danger-full-access)、/export 拒绝路径参数。
 * 中文讲解/四段示例为 tmd-cli 侧人工内容。dsh 升级后按同法重提。
 */
import type { AcademyCourse } from "@kernel/academy";
import { DSH_ACADEMY_LESSONS } from "./academyLessons";

export const DSH_ACADEMY_COURSE: AcademyCourse = {
  cliId: "dsh",
  title: "dsh 学堂",
  sourceVersion: "0.1.5-rc.1",
  chapters: [
    { id: "model-perm", title: "模型与权限", desc: "模型决定智商与花费,权限决定它敢不敢动手——开跑前先配好这两样", commands: [
      { name: "model", en: "Select the model for this conversation", zh: "选择本会话的模型与推理等级", detail: "弹「模型与推理等级」菜单。为什么:模型决定智商与花费——v4-flash 快而省,适合目标明确的常规活;v4-pro 自主编码与复杂推理更强,质量优先但要花更多钱。同一菜单里还能调推理等级(effort):档位越高想得越深,也更慢更贵。注意:只影响本会话;模型没选好前 composer 会被拦住提示先选模型。", how: "composer 旁的模型 pill 打开同一菜单", examples: [{ sc: "要开始一个复杂重构,想换强模型再拉高推理档", i: "/model", o: "弹出「模型与推理等级」菜单(选模型,或切到推理等级页)", e: "硬仗选 deepseek-v4-pro 并升推理档,常规活用 v4-flash 省钱——按任务难度配模型,是 dsh 省钱的第一杠杆。" }] },
      { name: "permission", en: "Switch the permission preset (sandbox mode + approval policy)", zh: "切换权限预设(沙箱模式+审批策略)", usage: "<preset>", detail: "安全边界开关。为什么:agent 要改文件、跑命令,权限太紧步步弹审批,太松又不放心;permission 一条命令在预设间切换。不带参数先看当前与可用预设;内置两档:workspace-write(工作区内可写,越界操作弹审批兜底)和 danger-full-access(沙箱全开、不再询问)。注意:切换即时作用于本会话;日常任务保持 workspace-write,放手大干再放开。", examples: [{ sc: "要放手让 agent 跑一场大规模重构,不想每步点审批", i: "/permission danger-full-access", o: "权限已切到 danger-full-access(沙箱全开、审批不再弹)", e: "速度最快但风险自负——只在可信仓库与明确任务用。拿不准就 /permission workspace-write,越界动作还有审批这道闸。" }] },
    ] },
    { id: "plan-goal", title: "计划与长任务", desc: "大任务先出方案再动手;长目标钉在会话上,断线续跑都不丢方向", commands: [
      { name: "plan", en: "Enter or leave plan mode", zh: "进入或退出计划模式(先规划后动手)", usage: "[off|message]", detail: "计划模式。为什么:大任务直接开跑容易跑偏;plan 模式下 agent 只读代码、只出方案,计划经你确认才落地执行。/plan 可带一句话,让它带着任务去调研;/plan off 退出恢复执行。注意:计划模式下它不改文件;方案要改就趁模式里提,确认后再放行。", examples: [{ sc: "接手陌生模块,想先看改造方案再动手", i: "/plan 把认证从 session 迁到 token,先出方案", o: "Plan mode on. Use /plan off to leave.(消息已作为调研任务发出)", e: "agent 只读不写,产出完整计划等你确认。满意后 /plan off 按计划开干;不满意就地改方向,零返工成本。" }, { sc: "方案确认完,准备放行执行", i: "/plan off", o: "Plan mode off.", e: "恢复常规执行模式,agent 按确认过的计划动手。" }] },
      { name: "goal", en: "set or view the goal for a long-running task", zh: "为长任务设定或查看目标(可暂停续跑)", usage: "[<objective>|clear|edit <objective>|pause|resume]", detail: "长任务锚点。为什么:长任务跑到一半上下文被压缩、或隔天续跑,「当初要干什么」容易糊;goal 把目标持久钉在会话上,agent 每轮都对齐它推进。还支持 pause/resume 暂停歇刀与续跑,edit 改写目标。注意:已有未完成目标时不能直接覆盖,先 edit 或 clear;附件只跟在设目标/改目标后面。", examples: [{ sc: "一个要跑几小时的数据迁移,先钉死目标再放手", i: "/goal 把 orders 表按月拆分迁移,并校验行数一致", o: "Goal created(显示目标与当前阶段)", e: "之后每轮 agent 都锚定目标推进,compact 丢了细节也丢不了方向。中途 /goal pause 歇刀、/goal resume 续跑,完工 /goal clear 收尾。" }] },
    ] },
    { id: "session-care", title: "上下文与产物", desc: "会话要会续命,成果要出得了门;顺手把反馈递给 DeepSeek", commands: [
      { name: "compact", en: "Compact older conversation history", zh: "手动压缩会话上下文", detail: "压缩上下文。为什么:会话越长越慢越贵;compact 把旧历史压成摘要腾出空间,长任务续命全靠它。上下文压力过大时 dsh 会自动触发,手动跑用于「我现在就要瘦身」。注意:agent 忙碌或已有压缩在进行时会拒绝;压缩有损,关键约束先写进 goal 或文档再压。", examples: [{ sc: "长会话跑了一下午,回复明显变慢变贵", i: "/compact", o: "会话开始压缩并产出摘要", e: "旧历史变摘要,上下文腾出空间,回复恢复轻快。重要约束(路径/接口签名)提前钉进 /goal,别赌摘要全记得。" }] },
      { name: "export", en: "Download this Session log as a ZIP archive", zh: "把本会话日志打包成 ZIP 下载", detail: "导出会话。为什么:dsh 的会话盘是 host 侧的流式存储,没法直接翻文件;export 一键把完整日志打成 ZIP 从浏览器下载,备份、交接、提工单附证据都靠它。注意:web 版不接受路径参数,文件直接落到浏览器下载目录;含敏感内容的会话导出前想清楚去向。", how: "浏览器直接下载,无 tmd-cli 面板入口", examples: [{ sc: "这轮排查过程有价值,想留档交接", i: "/export", o: "Session log download requested.(浏览器开始下载 ZIP)", e: "完整会话日志到手,压缩包内是原始日志。发人前先掂量里面的代码、地址与密钥。" }] },
      { name: "feedback", en: "record feedback about this session", zh: "记录对本次会话的反馈", usage: "<text>", detail: "反馈直通车。为什么:答错了、工具用得蠢、成本离谱——feedback 把反馈直接记进会话日志,是喂给 DeepSeek 的一手素材,比去社区发帖通道最短。可选分类:任务结果/指令遵循/交互体验/服务稳定性/资源成本/安全隐私。注意:反馈附在当前会话上留档;写清具体现象与复现路径才有用,纯「不好用」帮不上人。", examples: [{ sc: "agent 把你的指令理解反了,想顺手记一笔", i: "/feedback 拆分迁移时误删了原表备份,指令遵循有问题", o: "反馈已记录", e: "反馈随会话日志留档。具体现象+复现步骤+期望行为,三样写全才是一份有用反馈。" }] },
    ] },
  ],
  lessons: DSH_ACADEMY_LESSONS,
};
