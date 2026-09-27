/**
 * codex 学堂课程目录 —— codex-cli 0.157.0 内置斜杠命令核心集(29 条,5 章)。
 *
 * 真源与提取法:@openai/codex 0.157.0 平台原生二进制 node_modules/
 * @openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex(strings 提取),
 * 每条收录命令均满足「命令名 + 官方描述字符串同串在场」强信号(描述即 TUI
 * 弹层文案,如 "start a new chat during a conversation";/goal 的 usage 串
 * 亦从二进制直读)。调试/别名/边缘命令(test-approval、debug-m-*、pets、
 * voice、tui、daemon 等)按宁缺毋滥舍弃。中文讲解/详解/四段示例为 tmd-cli
 * 侧人工内容。codex 升级后按同法重提。
 */
import type { AcademyCourse } from "@kernel/academy";
import { CODEX_ACADEMY_LESSONS } from "./academyLessons";

export const CODEX_ACADEMY_COURSE: AcademyCourse = {
  cliId: "codex",
  title: "codex 学堂",
  sourceVersion: "0.157.0",
  chapters: [
    { id: "sessions", title: "会话:开始、找回与整理", desc: "codex 的对话现场是 thread;会开、会找回、会归档,主线就顺了", commands: [
      { name: "new", zh: "开始一个新对话", detail: "换任务先开新对话。为什么:上一任务的上下文会残留,新任务容易答非所问;新对话等于干净的脑子,旧的完整留盘可 /resume 找回。想连终端显示一起清掉用 /clear(清屏加新对话)。注意:任务跑着也能开,不打断已在后台的活。", how: "侧栏新建会话按钮直达同一动作", examples: [{ sc: "手头 bug 修完,要开始写新功能", i: "/new", o: "新对话已开始(输入区清空)", e: "上下文清零,旧 thread 留盘。新任务背景一次交代清楚,别指望它记得上一段的事。" }] },
      { name: "resume", zh: "找回并继续一个历史对话", detail: "恢复历史会话。为什么:昨天做到一半的活,今天第一件事就是 resume;恢复的是完整现场,不用重新交代背景。可以带关键词或 id 直取,免翻选择器;多个会话名字相近时用 UUID 精确匹配最稳。", usage: "[关键词或 id]", how: "侧栏 codex 分组点历史会话即同效(resume)", examples: [{ sc: "昨天让 codex 改到一半的爬虫,今天继续", i: "/resume", o: "弹出历史对话选择器", e: "选中昨天的对话即回到完整现场。会话多时带关键词直取;侧栏历史列表点击等效。" }] },
      { name: "fork", zh: "把当前对话分叉成新对话", detail: "现场分叉。为什么:同一个起点想试两条路线,fork 复制完整历史各跑各的,互不干扰;与 /new 的区别是 fork 带着全部上下文出发,不用重新交代。注意:分叉产生的是新 thread,原对话照旧;带图片的分叉有额外要求(需附 prompt)。", examples: [{ sc: "方案 A 走到一半,想保留现场再试方案 B", i: "/fork", o: "从当前对话分叉出新对话", e: "两条线从此各自演化。激进重构先 fork 再动手,原线始终是你的退路。" }] },
      { name: "archive", zh: "归档当前会话", detail: "归档整理。为什么:会话列表越长越难找;做完的活归档,列表里只留活跃的。注意:归档不是删除——归档的会话还在盘上,需要时仍可找回;别把还要继续的活误归档了。", examples: [{ sc: "一批旧会话把历史列表塞满了", i: "/archive", o: "当前会话已归档", e: "列表清爽,归档件沉底。周期性收尾:做完的归档、废弃的删除,列表才配得上「正在做的事」。" }] },
      { name: "rename", zh: "给当前对话改名", detail: "会话命名。为什么:一周后 /resume 时,列表里「Untitled」和「修支付回调」的找回成本天差地别;名字是未来自己的路标。注意:支持内联参数一步到位;名字只影响显示,不动内容。", usage: "<名称>", examples: [{ sc: "刚开始一个要跑三天的重构", i: "/rename 支付回调重构", o: "对话已改名:支付回调重构", e: "侧栏与 /resume 列表一眼认出。起名趁早,拖到会话成山就只能靠内容猜。" }] },
    ] },
    { id: "context", title: "上下文与信息", desc: "上下文是预算,信息是弹药;会压缩、会查账、会引文件,长任务才跑得动", commands: [
      { name: "compact", zh: "压缩对话历史腾出上下文", detail: "压缩续命。为什么:上下文越长越贵越迟钝;compact 把历史压成摘要腾空间,防撞上限。与 /recap 的区别:compact 是「为了继续跑而瘦身」,recap 是「给我一份摘要」。注意:压缩有损,关键约束(路径、接口签名)先落盘进文件或 AGENTS.md 再压。", examples: [{ sc: "长会话跑了半天,回复开始变慢变贵", i: "/compact", o: "对话已压缩为摘要", e: "历史瘦身、上下文腾空。重要接口签名别赌摘要记得,先落盘再压缩。" }] },
      { name: "recap", zh: "立即生成当前对话的摘要", detail: "现场摘要。为什么:换人接手、开新对话继承上下文、写进度汇报,都需要一份「到现在为止发生了什么」;recap 不动历史,只产出摘要。注意:摘要给人看或带进新对话,不改变当前对话的上下文。", examples: [{ sc: "要把进展交接给同事,或带进一个全新对话", i: "/recap", o: "输出当前对话的要点摘要", e: "拿摘要开新对话,不用从头读代码。交接材料 = recap 加 diff,十秒钟配齐。" }] },
      { name: "status", zh: "查看当前会话配置与 token 用量", detail: "会话仪表盘。为什么:模型、审批档位、token 花了多少还剩多少——一条命令看全;回复变慢变贵时先看它再动手。注意:这是本会话口径;账号级限额细账看 /usage,用量逼近上限就 /compact。", how: "composer 输入 / 有 status 候选", examples: [{ sc: "感觉 codex 最近回复变慢,想先弄清现状", i: "/status", o: "显示模型 · 审批策略 · token 用量 · 会话配置", e: "用量逼近上限就 /compact 或收尾换任务;配置不对就 /model、/permissions 纠偏。先看仪表盘再动手。" }] },
      { name: "usage", zh: "查看账号用量与限额重置", detail: "账号账单页。为什么:status 看会话,usage 看账号——本周期用量、限额何时重置都在这;撞限额前规划任务节奏全靠它。注意:显示的是账号口径(含其它会话),本会话细账看 /status。", examples: [{ sc: "下午连跑几个任务,担心额度见底", i: "/usage", o: "显示账号用量与限额重置时间", e: "额度紧就先干要紧的活;按重置时间点排任务优先级,别在 90% 处开大重构。" }] },
      { name: "diff", zh: "查看当前改动 diff", detail: "改动总览。为什么:让 codex 改了一堆文件,先看 diff 再表态——审它的活和让它干活一样重要;未跟踪的新文件也包含在内。注意:看到的是工作区相对 git 的改动;提交前过一眼是纪律。", how: "composer 输入 / 有 diff 候选", examples: [{ sc: "codex 说「修复完成」,要验收它改了什么", i: "/diff", o: "显示全部改动(含未跟踪文件)", e: "逐块过一遍:改的是不是你要的、有没有顺手乱改。满意再让它跑测试或提交。" }] },
      { name: "mention", zh: "引用一个文件到对话里", detail: "精确指路。为什么:「改一下那个配置文件」这种模糊指代会翻错文件;mention 把具体文件带进对话,agent 少猜一次。注意:tmd-cli 里 composer 的 @ 触发符是同一能力的原生入口,路径补全更快。", how: "composer @ 触发符即文件引用,等效更顺手", examples: [{ sc: "要让它重点看鉴权中间件", i: "/mention", o: "选择文件并引用到输入框", e: "文件作为明确上下文进入对话,指向零歧义。日常用 @ 更快;/mention 语义相同。" }] },
      { name: "copy", zh: "复制最近一条回复(或其片段)", detail: "一键复制。为什么:「把刚才那段方案发我」——滚屏手选容易断行错乱;copy 直取最近一条回复,干净利落。注意:只针对最近一条;要更早的内容或全量,用 /export 出 markdown。", examples: [{ sc: "codex 刚给出完整迁移方案,要贴进工单", i: "/copy", o: "最近回复已复制到剪贴板", e: "格式完整直贴。要的是整段历史而非单条,改用 /export。" }] },
      { name: "export", zh: "导出对话为 markdown", detail: "全量导出。为什么:复盘、写周报、存档排查过程,markdown 人人能读、随手可贴;这是把对话变成文档的出口。注意:导出的是完整对话;只差最近一条用 /copy 更轻。含敏感内容先掂量再外发。", examples: [{ sc: "一次完整排查要写成复盘文档", i: "/export", o: "对话已导出为 markdown 文件", e: "拿导出件删删改改就是复盘。密钥、内网地址这类敏感信息先清理再传播。" }] },
    ] },
    { id: "guide", title: "引导与审查", desc: "开局教它规矩,收尾让它自检;init/review/plan/goal 是质量的几道闸", commands: [
      { name: "init", zh: "生成 AGENTS.md 项目指南", detail: "项目开机自检。为什么:AGENTS.md 是 codex 的项目规矩(构建命令、目录约定、禁区);init 扫描仓库生成初稿,你补上人工约定,以后每个对话自动带着规矩干活。注意:生成的只是初稿,务必人工审改——规矩错了它将错就错。", how: "composer 输入 / 有 init 候选", examples: [{ sc: "第一次在现有仓库里用 codex", i: "/init", o: "生成 AGENTS.md(含项目结构与命令初稿)", e: "逐节补上团队约定:测试怎么跑、哪些目录别动。这个文件决定 codex 在你项目里的下限。" }] },
      { name: "review", zh: "让 codex 评审当前改动找问题", detail: "自检闸门。为什么:它改完的代码让它以审查者视角再过一遍,常能抓出边界条件与并发隐患;带参数可指定审查重点。注意:评审意见是输入不是判决,关键改动仍要人工复核;被中断的评审要重跑完整流程再下结论。", usage: "[审查要求]", how: "composer 输入 / 有 review 候选", examples: [{ sc: "它刚改完支付重试逻辑,提交前要一道关", i: "/review 重点看并发与超时处理", o: "输出问题清单(按严重度)", e: "逐条让它修或解释。高危路径(钱、权限)必须人工再过一道,评审不免责。" }] },
      { name: "plan", zh: "切换到 Plan 模式", detail: "先谋后动。为什么:大活直接开跑容易跑偏;Plan 模式下 codex 只读代码做方案,你确认方案再放行动手——方向错误在纸面上就截住,返厂成本最低。注意:方案确认后记得切回执行,不然它一直只出主意不动手。", examples: [{ sc: "要把状态管理从 Redux 迁到 Zustand,先要个靠谱方案", i: "/plan", o: "已切换到 Plan 模式(只读不改)", e: "拿到分步方案再决定。大改动的正确姿势:plan 定方案、执行做实施、review 收尾。" }] },
      { name: "goal", zh: "设定或查看长任务目标", detail: "北极星。为什么:长任务跑着跑着会漂;goal 把目标钉在那,你和 codex 随时对齐「在干嘛、为了啥」。注意:支持 clear/edit/pause/resume 子动作——目标变了用 edit 改,别让旧目标继续误导执行。", usage: "[<目标>|clear|edit|pause|resume]", examples: [{ sc: "挂了个跨小时的后台迁移任务", i: "/goal 把 user 表拆到 user_profile,保持 API 不变", o: "目标已设定", e: "每次交互都能对回这个目标。目标演进用 /goal edit 更新,完成后 /goal clear 收尾。" }] },
    ] },
    { id: "config", title: "模型与配置", desc: "模型定智商,权限定边界;这几条把 codex 调成你的安全区", commands: [
      { name: "model", zh: "选择模型与推理力度", detail: "切大脑。为什么:读代码要强模型、跑杂活用便宜的;model 一个选择器同时定模型和 reasoning effort,直接决定智商与花费。注意:只影响之后的回合,不清上下文;费用敏感的日常活,别把最高档 effort 常开。", how: "composer 模型 pill 即可视切换;/ 菜单有 model 候选", examples: [{ sc: "要开始啃一个大库的架构,需要更强推理", i: "/model", o: "弹出模型与推理力度选择器", e: "啃硬骨头选强模型加高档 effort,杂活切回默认档。随时可切,互不影响。" }] },
      { name: "permissions", zh: "选择 codex 可以做什么", detail: "审批档位。为什么:这是安全边界——改文件、跑命令要不要先问你,由档位决定;激进档省确认但有风险,保守档每步确认但磨人。注意:陌生仓库从严格档起步;放宽是临时的,干完记得调回。", how: "composer 输入 / 有 permissions 候选", examples: [{ sc: "要让它全速重构,但担心它乱跑命令", i: "/permissions", o: "弹出权限档位选择器", e: "按任务选档:陌生仓库只读起步,自己的沙箱里再放开。审批弹窗不是干扰,是最后一道闸。" }] },
      { name: "mcp", zh: "列出已配置的 MCP 工具", detail: "工具箱盘点。为什么:接了 MCP server 后有哪些工具可用、状态如何,一条命令列全;带 verbose 看细节,排查「工具没挂上」最管用。注意:tmd-cli 侧 codex 的 MCP 配置真相在 ~/.codex/config.toml 的 [mcp_servers] 段,没出现先回去对账。", usage: "[verbose]", how: "配置管理面可查看 codex MCP 服务器清单", examples: [{ sc: "配了个数据库 MCP,想确认工具挂上了", i: "/mcp verbose", o: "列出 MCP server 与工具(含详情)", e: "列表里有 = 挂上了,直接用;没有就回 config.toml 查段名与 command 是否写对。" }] },
      { name: "skills", zh: "查看与使用技能", detail: "技能面。为什么:技能 = 预制的流程包(部署、发版、评审套路);skills 让 codex 按既定清单干活,比每次现编 prompt 稳。注意:技能来自项目与全局目录,codex 自发现;装新技能前先读内容——它会以你的名义执行。", how: "composer $ 触发符即技能 mention,原生直调", examples: [{ sc: "想让发版流程按既定清单走", i: "/skills", o: "列出可用技能", e: "选用对应技能,codex 按清单执行。高频流程沉淀成技能,一次编写次次受益。" }] },
      { name: "theme", zh: "选择语法高亮主题", detail: "读码配色。为什么:每天盯几小时的 diff 和代码块,配色顺眼疲劳减半;theme 列出全部主题,即选即换。注意:改的是语法高亮配色,不影响终端整体配色方案。", examples: [{ sc: "深色终端里代码高亮看不清", i: "/theme", o: "弹出主题选择器(即选即预览)", e: "挑个对比度合适的。小投入大回报,眼睛是自己的。" }] },
      { name: "vim", zh: "开关输入框 Vim 模式", detail: "编辑器手感。为什么:vim 肌肉记忆的人用默认输入框浑身难受;开了 vim 模式,composer 就是熟悉的模态编辑。注意:只影响输入框编辑,不影响其它交互;不熟 vim 别开,开了想关再敲一次 /vim。", examples: [{ sc: "vim 老用户,想用惯用键位改长 prompt", i: "/vim", o: "Vim 模式已开启(输入框支持模态编辑)", e: "Esc 进 normal 模式照常操作。共用机器上记得退出前切回,免得下个人懵。" }] },
      { name: "logout", zh: "退出 codex 登录", detail: "退认证。为什么:换号、借出机器、回收凭据时必须主动退,光删文件可能留残留 token。注意:退出后要重新登录才能用;确认有备用认证方式再操作,别把自己锁外面。", examples: [{ sc: "这台共用机器登着我的 ChatGPT 号", i: "/logout", o: "已退出登录", e: "凭据立即失效。公共机器养成「用完即退」的习惯;换回自己的号重新登录即可。" }] },
      { name: "quit", zh: "退出 codex", detail: "收工退出。为什么:终端里退得干净——会话已落盘,/resume 随时找回;/exit 是同一动作的别名。注意:有后台终端跑着先 /ps 看一眼,确认没有要紧活再退。", examples: [{ sc: "今天的活收尾了", i: "/quit", o: "codex 退出(会话已保存)", e: "现场已落盘,明天 resume 接着来。跑着长任务的先 /ps 清点后台再退。" }] },
    ] },
    { id: "parallel", title: "后台与并行", desc: "子代理、侧聊、worktree、后台终端——codex 的多线作战面", commands: [
      { name: "agents", zh: "打开代理指挥中心", detail: "多代理中枢。为什么:大活拆给多个子代理并行跑时,谁在跑、进度如何、要不要干预,一个面板看全。注意:代理吃并发与额度,拆之前想清楚任务是否真的可并行;串行任务硬拆只会添乱。", examples: [{ sc: "三模块迁移拆给三个子代理并行", i: "/agents", o: "打开代理指挥中心(状态与进度一览)", e: "盯进度按需干预:卡住的取消、跑偏的拉回。并行是好刀,别拿去切串行任务。" }] },
      { name: "side", zh: "开一个侧聊(临时分叉)", detail: "不打断主线的支线。为什么:主线任务跑着,突然想问个不相干的小问题;side 从当前对话开一个临时分叉,问完就丢,主线上下文零污染。注意:侧聊是临时现场,重要结论手动抄回主线;/btw 是它的别名。", examples: [{ sc: "主任务跑着,顺手想查一个无关报错", i: "/side", o: "已进入侧聊(临时分叉)", e: "小问题在侧聊解决,主线不受打扰。侧聊结论要留用的,带回主线或落盘。" }] },
      { name: "worktree", zh: "在新 worktree 里开对话", detail: "物理隔离。为什么:激进重构最怕和手头未提交的改动搅在一起;worktree 给对话一个独立工作目录,git 分支互不踩脚。注意:需要在配置里开启 worktree 支持,且要求主会话空闲;新 worktree 首次要重新信任目录。", examples: [{ sc: "主线有未提交改动,又想让 codex 试个大改", i: "/worktree", o: "在新 worktree 中开起新对话", e: "大改在隔离目录里折腾,主线工作区纹丝不动。验证满意再合,不满意整目录一删了之。" }] },
      { name: "ps", zh: "列出后台终端", detail: "后台盘点。为什么:让 codex 挂起的 dev server、长测试都在后台终端里;ps 列出它们的状态,知道谁还在跑、占了什么。注意:收工前先 /ps 后 /stop(一键停掉全部后台终端),别留着占资源的进程过夜。", examples: [{ sc: "今天挂过 dev server 和一个长测试,收工前核对", i: "/ps", o: "列出后台终端及其状态", e: "确认无要紧活后 /stop 全停。后台进程是资源黑洞,下班前清场是纪律。" }] },
    ] },
  ],
  lessons: CODEX_ACADEMY_LESSONS,
};
