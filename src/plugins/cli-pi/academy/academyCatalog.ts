/**
 * pi 学堂课程目录 —— pi 0.84.1 全部 22 条内置斜杠命令(5 章)+ /skill: 调用面。
 *
 * 真源与提取法:pi 仓库 packages/coding-agent/src/core/slash-commands.ts 的
 * BUILTIN_SLASH_COMMANDS(逐条对过 interactive-mode.ts 的 dispatch 真实行为:
 * fork/tree/trust 弹选择器、model 带搜索词精确直切、compact 支持自定义指示)。
 * 中文讲解/详解/四段示例为 tmd-cli 侧人工内容。pi 升级后按同法重提。
 */
import type { AcademyCourse } from "@kernel/academy";
import { PI_ACADEMY_LESSONS } from "./academyLessons";

export const PI_ACADEMY_COURSE: AcademyCourse = {
  cliId: "pi",
  title: "pi 学堂",
  sourceVersion: "0.84.1",
  chapters: [
    { id: "sessions", title: "会话:开始、找回与退出", desc: "pi 的一切都在会话里;会开、会找、会认名,就掌握了主线", commands: [
      { name: "new", zh: "开始一个新会话", detail: "换任务先开新会话。为什么:上一任务的上下文会残留干扰,新任务容易答非所问;新会话等于干净的脑子。旧会话完整留盘,随时 /resume 找回,开新零成本。注意:同一任务想重新开始也是它,pi 没有 /clear,新会话即翻篇。", how: "侧栏新建会话按钮直达同一动作", examples: [{ sc: "手头 bug 修完,要开始写新功能", i: "/new", o: "新会话已开始(输入区清空)", e: "上下文清零、旧会话留盘。开始前把新任务背景一次交代清楚,别指望它记得上一个会话的事。" }] },
      { name: "resume", zh: "找回并继续一个历史会话", detail: "恢复历史会话。为什么:昨天做到一半的活,今天打开 pi 第一件事就是 resume;恢复的是完整现场(消息、上下文、分支树),不用重新交代背景。注意:恢复的是哪一个要认准名字——这就是 /name 养成习惯的价值。", how: "侧栏历史会话点一下等效恢复", examples: [{ sc: "昨天改到一半的解析器,今天继续", i: "/resume", o: "弹出会话选择器(列出历史会话)", e: "选中昨天的会话即回到完整现场,连分支树都在。找不到时先想想当时有没有 /name;列表按时间排,最近的在前。" }] },
      { name: "import", zh: "从 JSONL 文件导入并恢复会话", detail: "导入会话文件。为什么:换机器、拿同事的会话存档、或从备份恢复,import 直接把 jsonl 变成可继续的现场。注意:导入的是会话文件(可用 /export jsonl 产出),不是随意文本;导入后原文件不动。", examples: [{ sc: "同事发来他的会话存档,要接着他的进度查问题", i: "/import", o: "选择 JSONL 文件 → 会话已导入", e: "对方的会话现场完整到你这里,包括上下文。查看他人会话时注意其中可能含敏感信息。" }] },
      { name: "session", zh: "查看当前会话信息与统计", detail: "会话档案。为什么:「这个会话跑了多少 token、用的哪个模型、文件在哪」一条命令看全;排查和汇报都用得上。注意:统计是当前会话口径,跨会话汇总看 tmd-cli 侧栏的会话管理面。", how: "重命名/删除/置顶在侧栏会话右键菜单", examples: [{ sc: "想确认当前会话用的模型和 token 消耗", i: "/session", o: "显示会话信息:模型 · 消息数 · token 用量 · 会话文件路径", e: "数字对不上直觉时,多半是上下文该压缩了(/compact)。会话文件路径在 glm 里可以直接备份。" }] },
      { name: "name", zh: "给当前会话起显示名", detail: "会话命名。为什么:一周后 /resume 时,列表里「default」和「修支付回调」的找回成本天差地别;名字是未来自己的路标。注意:不带参数会提示输入;名字只影响显示,不影响内容。", how: "侧栏会话右键重命名等效", examples: [{ sc: "刚开始一个要跑三天的重构任务", i: "/name 支付回调重构", o: "会话已命名:支付回调重构", e: "侧栏和 /resume 列表里一眼认出。起名趁早——拖到会话多了再起,就要靠内容猜了。" }] },
      { name: "quit", zh: "退出 pi", detail: "退出应用。为什么:终端里退出要干净——会话自动落盘,不用怕丢;但跑着的后台任务和未确认的操作会停在那。注意:收工前瞄一眼 /session 确认没有未收尾的事,再退。", examples: [{ sc: "今天的活干完了,关终端走人", i: "/quit", o: "pi 退出(会话已保存)", e: "会话状态已落盘,明天 /resume 接着来。有未完成的长任务先等它收尾或确认可中断,再退。" }] },
    ] },
    { id: "model", title: "模型与账号", desc: "模型决定智商与花费;认证决定能不能跑。这两个第一天就要会", commands: [
      { name: "model", zh: "选择模型(选择器,可带搜索词直切)", detail: "切模型。为什么:不同任务配不同模型——读代码要强脑、改文件要省钱;model 弹选择器,背熟名字可以直接 /model <provider/model> 精确命中秒切。注意:只影响本会话,新会话回默认;Ctrl+P 的快切清单用 /scoped-models 配。", usage: "[provider/model]", how: "composer 模型 pill 即可视切换", examples: [{ sc: "要开始读大量代码,换强模型", i: "/model", o: "弹出模型选择器(Enter 切换)", e: "浏览全部可用模型;带搜索词如 /model anthropic/claude 精确命中时直接切换不弹窗。切模型不影响已产生的上下文。" }] },
      { name: "scoped-models", zh: "配置 Ctrl+P 快捷轮换的模型清单", detail: "管理快切清单。为什么:常用的就那两三个模型,把它们圈进 scoped 清单后 Ctrl+P 一键轮换,不用每次进选择器翻全量列表。注意:清单只影响 Ctrl+P 轮换顺序,不限制 /model 能选什么。", examples: [{ sc: "日常就是 GLM 和 Sonnet 两个模型来回切", i: "/scoped-models", o: "弹出模型启用/禁用清单", e: "勾选常用模型后,Ctrl+P 只在这几个之间轮换。清单保持两三个最顺手,多了反而失去快切意义。" }] },
      { name: "login", zh: "配置供应商认证(OAuth/API key)", detail: "配认证。为什么:新供应商第一次用、或 token 过期重登,都要过 login;OAuth 走浏览器授权吃订阅额度,API key 按量计费——选错方式直接影响账单。注意:不带参数弹供应商选择器;订阅用户优先 OAuth。", usage: "[provider]", how: "welcome 引擎卡的凭据入口管理同一凭据", examples: [{ sc: "刚装好 pi,要接上订阅的供应商", i: "/login", o: "弹出供应商选择 → 浏览器 OAuth 授权", e: "授权完成即可对话。订阅套餐走 OAuth;贴 API key 是按量计费——「有订阅还被扣钱」多半是这里选错了方式。" }] },
      { name: "logout", zh: "移除供应商认证", detail: "退认证。为什么:换号、借出机器、回收凭据时必须主动退,光删配置可能留残留 token。注意:logout 弹 OAuth 选择器选要退的供应商;退完该供应商立刻不可用,确认有备用通道再操作。", examples: [{ sc: "这台共用机器登过我的号,要走了", i: "/logout", o: "弹出 OAuth 选择器 → 选中即移除", e: "token 立即失效。退出前确认另一供应商或 key 可用,别把自己锁外面。" }] },
      { name: "settings", zh: "打开设置菜单", detail: "设置入口。为什么:主题、默认模型、上下文阈值这些一次性配置,配完就忘;settings 菜单集中管理,不用翻文档找配置文件字段。注意:多数设置即时生效;改完不满意的项可以再进来改回。", examples: [{ sc: "想看看 pi 都能配什么", i: "/settings", o: "弹出设置菜单(分类浏览)", e: "逐项过一遍,把默认模型和主题先配成顺手的。设置存在用户级配置,所有会话共享。" }] },
    ] },
    { id: "branch", title: "分支与上下文", desc: "对话可以分叉回退;上下文要会压缩——这是 pi 的试错保险和续命术", commands: [
      { name: "fork", zh: "从之前某条消息分叉出新会话", detail: "历史分叉。为什么:同一个起点想跑两条独立路线,fork 复制现场各跑各的,互不干扰。注意:/fork 弹消息选择器选分叉点(pi 的 fork 不带位置参数,带参会被当普通消息发出);原会话照旧,复制不是移动。", examples: [{ sc: "一个需求想同时试两套方案,各自独立推进", i: "/fork", o: "弹出用户消息选择器 → Forked to new session", e: "选一条历史消息即分叉,两条线完全独立。别 fork 太多顾不过来;两套方案都值得认真跟才值得分叉。" }] },
      { name: "clone", zh: "在当前位置完整复制一份会话", detail: "原地复制。为什么:接下来要做危险操作(批量改文件、跑破坏性命令),先 clone 一份,搞砸了原会话还在;和 fork 的区别是 clone 不用选点、就复制当前这一刻。注意:克隆体与本体到此为止完全相同,之后各自演化。", examples: [{ sc: "马上要让 agent 批量重构,怕它搞砸", i: "/clone", o: "Cloned to new session", e: "克隆会话里放心折腾,本体原样保留。搞砸了切回本体重来,相当于免费的时光机存档。" }] },
      { name: "tree", zh: "打开会话树,在分支间切换", detail: "分支地图。为什么:fork 多了「哪条分支试过什么」全靠记忆;tree 一屏画出分叉结构,选中即切换。注意:切换分支是把现场切过去,不是合并;废分支没有删除命令,别开太多。", examples: [{ sc: "上周 fork 的两条路线,想回去看 A 路线的产出", i: "/tree", o: "弹出会话树选择器(选中分支即切换)", e: "树里选中目标分支即切过去,上下文跟着切。定期收编结论(抄走有效产出),别让树长成迷宫。" }] },
      { name: "compact", zh: "手动压缩会话上下文", detail: "压缩上下文。为什么:上下文越长越贵越迟钝;compact 把历史压成摘要腾出空间,长任务续命全靠它。可以带自定义指示,告诉它「压缩时保留哪些细节」。注意:压缩有损,关键约束(文件路径、接口签名)写进指示里保住;pi 在接近上限时也会自动压。", usage: "[自定义保留指示]", examples: [{ sc: "长会话跑了半天,回复开始变慢变贵", i: "/compact 保留 parse.ts 的接口签名与已修复文件清单", o: "Session compacted 1 times", e: "历史被压成摘要,保留指示里点名的细节。压缩后细节丢失不可逆——重要约束一定写进指示,别赌摘要会记住。" }] },
    ] },
    { id: "share", title: "分享与导出", desc: "成果出得了门:导出文件、加密链接、一键复制", commands: [
      { name: "export", zh: "导出会话(HTML 默认,可选 JSONL)", detail: "导出会话。为什么:决策过程和代码演进都有交接价值,html 发出去人人能读,jsonl 是可 /import 的完整现场备份——一份两种用途。注意:默认 HTML;路径以 .jsonl 结尾则导出原始格式。含敏感内容的会话导出前想清楚传播范围。", usage: "[path.html | path.jsonl]", examples: [{ sc: "这套重构的决策过程要同步给没参与的人", i: "/export", o: "Session exported to: <路径>.html", e: "单文件发出去即可读。要给同事继续跑的现场,导 .jsonl 让他 /import;敏感内容先掂量。" }] },
      { name: "share", zh: "分享会话为 GitHub secret gist", detail: "gist 分享。为什么:远程给人看会话,粘贴排版全毁;share 把会话传成 GitHub secret gist,链接给权限内的人即看。注意:走你的 GitHub 账号,内容离开本机——密钥、内网地址先想;gist 可到 GitHub 删除,比裸链接可控。", examples: [{ sc: "要让远程同事看完整的排查过程", i: "/share", o: "已创建 secret gist 并复制链接", e: "对方打开链接即读完整会话。secret gist 不进搜索但链接即权限,只发给该看的人;内容敏感改用 /export 定向发送。" }] },
      { name: "copy", zh: "复制最近一条 agent 消息到剪贴板", detail: "一键复制。为什么:「把刚才那段方案发我」——滚屏手选容易断行错乱;copy 直取最近一条 agent 消息全文,干净利落。注意:只复制最近一条;要更早的内容滚屏手选,或 /export 全量导。", examples: [{ sc: "agent 刚给出了完整的修复方案,要贴给同事", i: "/copy", o: "Copied last agent message to clipboard", e: "全文已在剪贴板,直接粘贴。连续多轮输出时确认最新一条就是你要的那条。" }] },
    ] },
    { id: "custom", title: "定制、技能与维护", desc: "把 pi 调成自己的:自定义命令、项目信任、日常维护", commands: [
      { name: "reload", zh: "热重载配置(键位/扩展/技能/prompts/主题/上下文文件)", detail: "重载配置。为什么:改了 AGENTS.md、技能文件、键位绑定,重启会话太重;reload 秒级全量生效,调配置必备。注意:范围覆盖键位、扩展、技能、prompts、主题、上下文文件;插件配置行为异常时重启一次兜底。", examples: [{ sc: "刚给项目补了一条 AGENTS.md 约定,要立即生效", i: "/reload", o: "配置已重载(键位/扩展/技能/主题/上下文文件)", e: "不用开新会话,约定即刻生效。若重载后行为诡异,重启一次会话排除有状态加载器的问题。" }] },
      { name: "trust", zh: "保存项目信任决定", detail: "项目信任。为什么:pi 对新目录默认谨慎(防提示注入);确认这是自己的可信项目后,trust 记住决定,以后不再每次询问。注意:只对确认可控的项目用—— cloned 的陌生仓库别急着 trust,先读读它的 AGENTS.md 和脚本。", examples: [{ sc: "自己的老项目,每次打开都问要不要信任", i: "/trust", o: "项目信任已保存", e: "这个目录以后不再询问。陌生仓库保持不信任直到读完它的指令文件——提示注入就藏在「看起来正常」的文档里。" }] },
      { name: "changelog", zh: "查看版本更新日志", detail: "更新日志。为什么:pi 迭代快,新命令新行为都在 changelog 里;升级后扫一眼,别用旧习惯错新版本。注意:看的是当前安装版本的日志;想了解全部历史看仓库 releases。", examples: [{ sc: "刚升级完 pi,想知道有什么新东西", i: "/changelog", o: "显示最近版本更新条目", e: "重点看 breaking changes 和新命令。养成升级后扫一眼的习惯,能少踩很多「怎么行为变了」的坑。" }] },
      { name: "hotkeys", zh: "显示全部键盘快捷键", detail: "快捷键总表。为什么:pi 的效率上限一半在键盘——分支、复制、模型轮换都有快捷键;hotkeys 一屏列全,每周扫一遍总有新收获。注意:改过键位绑定的以重载后的为准。", examples: [{ sc: "看同事不用鼠标就完成了分支切换,想知道还有什么键", i: "/hotkeys", o: "显示全部快捷键列表", e: "挑两三个高频场景的记住(模型轮换/复制/分支),肌肉记忆练成后效率翻倍。" }] },
      { name: "skill:<name>", zh: "调用一个技能(展开为完整提示词发送)", detail: "技能调用。为什么:技能 = 预制的提示词工程包;skill:react-review 这种形式把整套审查流程一步发出,不用每次手打长 prompt。技能来自项目/全局技能目录,装了什么就能调什么。注意:技能名跟在 skill: 后,参数空格接着写;装技能前看内容——它会以你的名义发出。", usage: "<args>", examples: [{ sc: "想让 agent 按既定流程做一轮代码评审", i: "/skill:code-review 重点看并发安全", o: "技能内容展开为提示词发送(含你的参数)", e: "技能把整段工程化 prompt 一步带入,参数追加在尾部。技能目录里有什么就能调什么;自己也可以写技能沉淀常用流程。" }] },
    ] },
  ],
  lessons: PI_ACADEMY_LESSONS,
};
