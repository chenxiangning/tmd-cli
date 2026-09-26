# 客户端能力盘点:多智能体工作台痛点对照与优化方向

日期:2026-09-26
状态:完成(痛点对照与优先级建议;非选题决策,拍板权在用户)
方法:两路并行调研——① 程序员管理多 AI coding agent 会话的真实痛点(HN 一手讨论帖);② 竞品舆情与功能基线(Conductor/Crystal/Vibe Kanban/Omnara/Sculptor/Claude Code Desktop/Warp/Wave/Ghostty);另做代码级现状核对。局限:搜索通道受限,引文以 HN 为主,Reddit/linux.do/X 未覆盖;「普遍度」为分析者主观估计。上游:`similar-products.md`(09-06 静态盘点),本文负责其状态校正与痛点维度的补全。

## 结论先行

1. **路线被验证**:「原生 PTY 幕布 + 不渲染」在 2026-09 的舆情里恰好是竞品的共同放弃点与用户的抱怨源(「UI wrapper 终端性能差、新功能滞后」),tmd-cli 的坚持正中验证;同时「多 agent 并行 + worktree 隔离 + 审批通知 + diff 审查 + 随处接管」已被官方(Claude Code Desktop 2026-04 重构)定型为 table stakes,tmd-cli 大半在手。
2. **六类痛点对照**:四类已有正面覆盖(并行切换/成批审批/额度展示/远程监工),三个接近零覆盖的硬空白——**离开工位的通知断层**、**额度撞墙后的动作**(只能看见不能接力)、**会话历史检索**(能浏览不能搜)。
3. **P0 三件**:OS 系统通知 + 手机推送通道;撞墙预警与跨引擎一键接力;会话转录全文检索。三者都贴合现有架构(askWatch 状态位 / quota 通道 / CLI JSONL 适配器 + sqlite 只读原语),零新增检测面。
4. **P1 四件**:审批疲劳纵深(高危升级标记/拒绝后引导)、worktree 编排(建/清)、失败回合分类与 Retry、per-session 用量估算。
5. **P2 战略题**(不拍板):跨 agent 委托、自动化调度、内嵌浏览器、provider preset、跨 CLI 会话迁移。
6. **明确不追**:幕布内二次渲染、Generative UI、强制登录与账号体系(竞品最大差评主轴,反向清单)。

## 一、赛道状态(2026-09)

- **官方下场**:Anthropic 于 2026-04 围绕「并行会话」重构 Claude Code Desktop(preview/code review/接管 CI&PR/本地-云端漫游;[官方博客](https://claude.com/blog/claude-code-desktop-redesign)、[MacRumors](https://www.macrumors.com/2026/04/15/anthropic-rebuilds-claude-code-desktop-app/))。品类方向被官方背书,单 CLI 包装器(Crystal/Conductor 类)护城河被压缩——**差异化必须落在多 CLI + 跨端 + 自托管**,恰是 tmd-cli 的既有定位。
- **table stakes 已定型**:worktree 隔离、审批/完成通知、内置 diff 审查、手机/web 接管(Conductor 228 分 Show HN、Vibe Kanban 195 分、Omnara 310 分与 147 分两次发布;链接见文末)。
- **用户对 UI wrapper 的警惕是硬信号**:「prefer using coding CLIs instead of UI wrappers——终端性能更好、新功能即得」([HN](https://news.ycombinator.com/item?id=46758682))。tmd-cli 的 PTY 字节级透传 + 各 CLI 自管 resume,在这条最容易被骂的轴上是干净的。
- **竞品差评主轴(反向清单)**:强制 GitHub OAuth/登录(Conductor,[HN](https://news.ycombinator.com/item?id=44737387))、闭源隐私顾虑、订阅涨价(Omnara $9→$20)、移动端残缺(裸文本输入框、无 slash/技能建议、不能开新会话)。tmd-cli 本地优先 + 无账号 + 手机全功能,四条全避开。

## 二、痛点 ↔ 能力对照(六类)

| # | 痛点(证据强度) | tmd-cli 现状(代码级) | 判定 |
|---|---|---|---|
| 1a | 人脑是瓶颈,2 个并行会话即上限,脑内 context-switch 最难([Ask HN](https://news.ycombinator.com/item?id=47573483),高) | 统一窗口 + 会话 tab 平铺 + 呼吸灯状态 + Ask 胶囊/提示音,切换成本已压到最低 | 已覆盖 |
| 1b | worktree 原语存在但「编排层」缺失,多 tab 手工搬运([ChatML](https://news.ycombinator.com/item?id=47303711),高) | git 面板能识别 worktree(kind 标签)与看分支差异,但无 `worktree add` 创建流、无悬空清理 | **缺(见 P1-5)** |
| 1c | 悬空 worktree 积压成灾、并行改动互相踩(中) | 跨会话文件冲突雷达已有设计原型(`design/session-conflict-radar.html`,只预警不拦截) | 原型在途 |
| 2a | 审批疲劳:自动驾驶式点 Approve,疲劳推向 YOLO 模式([IAXT](https://news.ycombinator.com/item?id=48830666)、[Cowork](https://news.ycombinator.com/item?id=47218288),高) | 审批线按轮成批(方向正确)+ 审批收件箱聚合应答已落地;但批内文件无危险度分层,拒绝后无引导 | 浅(见 P1-4) |
| 2b | 「拒绝之后无路可走」,无诊断与重触发路径(中) | 收件箱自由文本应答可留言;但「拒绝」本身发生在 CLI TUI 内,客户端无 doctor 式引导 | 浅(见 P1-4) |
| 3a | 撞墙即停摆,被单一供应商锁死([ShellTeam](https://news.ycombinator.com/item?id=49097325),高) | QUOTA chip 有水位 + 重置倒计时(7 类供应商协议适配);撞墙后无任何动作 | **缺动作(见 P0-2)** |
| 3b | 撞墙后降级接力全靠手工,多账号套利(高) | 10 引擎同窗是接力得天独厚的底座,但无「一键把工作转到另一引擎」 | **缺(见 P0-2)** |
| 3c | 长任务吞 token 无感(agent teams ~7×)(中) | 欢迎页 TOKENS 近 7 日图;无 per-session/per-任务 估算 | 浅(见 P1-7) |
| 4a | compaction 后丢线、长会话记忆衰减、忘目录([octocode 帖](https://news.ycombinator.com/item?id=47260741),高) | 属 CLI 自身行为;客户端侧缓解 = memory-coordinator 蒸馏(二期 opt-in 未做) | 受限可缓解 |
| 4b | 会话历史检索:跨会话找「之前让它做过什么」(高) | 磁盘历史分组浏览 + RESUME 8 条 + 看板;**无全文检索**(memory FTS 是记忆库不是转录) | **缺(见 P0-3)** |
| 5a | 「走开→回来发现卡在等审批」是最普遍场景,催生整批工具([claude-relay](https://github.com/chadbyte/claude-relay),高) | Ask 检测双通道 + 提示音 + 未读 + 手机 App 实况/审批卡 + 审批收件箱;但**无 OS 系统通知、无手机推送**(手机要 app 活着) | **缺断层(见 P0-1)** |
| 5b | 现役方案是 hooks+ntfy+tmux 手工拼装,封装类工具「没有完全顺手的」([Herdr](https://news.ycombinator.com/item?id=48756578),高) | 同上,一体化方案是机会而非包袱 | 机会 |
| 5c | 手机端「只能通知不能操作」的断层:要看 diff、发短指令([On-the-Go](https://granda.org/en/2026/01/02/claude-code-on-the-go/),中) | M2 已有会话屏 + 审批卡 + 键盘工具条 + 真实键序列;截图/语音输入缺 | 大体覆盖,输入侧见 P1-8 |
| 6a | 重复 prompt 多会话搬运(中) | 平铺广播输入一次喂全部幕布 | 已覆盖 |
| 6b | CLI 迭代太快记不住命令/技能(中) | CLI 学堂(academy)已落地(omp 82 命令/13 课),composer 触发器补全以 CLI 为真相源 | 已覆盖(独有) |
| 6c | 远程贴截图/发语音痛苦([ShellTeam](https://news.ycombinator.com/item?id=49097325),中) | 桌面 Composer 截图/拖拽/粘贴齐全;手机侧无截图注入与语音 | 缺(P1-8) |

## 三、P0 建议(三件,均贴合现有架构零新增检测面)

### P0-1 离开工位的通知闭环:OS 系统通知 + 手机推送

- **依据**:六类痛点里证据最强的一类(5a/5b,高普遍度);Omnara 被赞的核心恰是「推送 + 随处接管」;tmd-cli 的检测面(askWatch 双通道、turnSettled、sessionsChanged)全部现成,缺的只是「把事件送出窗口」的最后一公里。
- **现状**:应用内提示音 + 未读 + 手机 App 轮询(要 app 活着,AskFloatingBadge 也一样);离开窗口 = 失明。
- **方案**:① 桌面 OS 通知:Tauri notification 插件,设置页「系统通知」分区(Ask/轮次结束/会话退出三开关,失焦才发),事件源零新增;② 手机推送:自建中继已是长连 WS,中继侧断连检测 + APNs/FCM 推不含内容的「会话 X 等待确认」哑通知,点开走既有配对通道。一期先做桌面 OS 通知(成本极低),手机推送二期。
- **风险**:通知骚扰(默认只推 Ask 等待,节流合并);iOS 推送需开发者账号与后台任务模式(与现有壳工程同一套)。

### P0-2 额度撞墙预警与跨引擎一键接力

- **依据**:3a/3b(高);「撞墙即停摆 + 供应商锁死」是 ShellTeam/套利评论的核心叙事;tmd-cli 十引擎同窗是所有竞品不具备的接力底座(cc-switch 只切配置不管会话,codeg 有 15 agent 但无会话摘要接力)。
- **现状**:QUOTA chip 能看见水位;撞墙后用户手工开新引擎、重贴 prompt、丢上下文。
- **方案**:① 预警:水位阈值(如 90%)触发通知(接 P0-1 通道);② 一键接力:会话 tab 右键「转到引擎 Y」= 用该引擎开新会话 + 注入前会话转录尾部摘要(各 CLI JSONL 适配器已在,摘要生成可用用户配置的任一引擎;显式生成过程,不做自动迁移);③「轻接力」优先,ShellTeam 式 session-file 格式翻译列为高风险远期(各家格式变动频繁,翻译脆弱)。
- **风险**:摘要质量(显式可预览可编辑再发);额度 API 各家覆盖不齐(已有 7 类适配,未覆盖引擎降级为手动)。

### P0-3 会话历史全文检索

- **依据**:4b(高,证据最硬的一类空白);opcode 把「会话历史 + 智能搜索 + resume」当核心能力;tmd-cli 历史只能按时间浏览。
- **现状**:各 CLI 磁盘 JSONL 适配器(listSessions/readTranscript)已在;memory-coordinator 已有 SQLite FTS5 检索先例;Rust 侧 `sqliteQuery` 只读原语已在。
- **方案**:本地检索索引(归 checkform 插件或新 feature 插件):后台增量扫转录 JSONL → FTS5 表(会话 id/引擎/时间/命中行),入口放会话列表搜索框与命令抽屉;只读不写各家文件,格式知识留插件侧(内核不理解私有格式铁则不破)。
- **风险**:大仓长历史的索引体积与扫描耗(增量 + mtime 水位,同 checkpoints 水位纪律);各家 JSONL schema 漂移(适配器层消化)。

## 四、P1 建议(四件)

1. **审批疲劳纵深**(2a/2b):批内文件危险度分层标记(路径敏感度:settings/启动脚本/CI 配置 → 高危红标,规则放 checkpoints 插件本地);「拒绝并留言」语义收口(收件箱已有自由文本应答,补拒绝场景的引导文案与「到幕布重触发」提示);test gating(封批前自动跑测试,竞品 Batty 指出「没有 test gating 是最大混乱源」)列为远期。
2. **worktree 编排**(1b/1c):新建会话菜单加「在 worktree 中打开」(`git worktree add` + 挂工作区 + 会话绑定);git 面板加悬空 worktree 清单与清理;冲突雷达原型推进落档。
3. **失败回合分类与 Retry**:会话退出态分类(正常退出/崩溃/疑似额度) + 会话行标态与一键 resume(omp 预热接管机制已在,扩展到崩溃恢复路径);codeg 已验证此能力被用户当卖点。
4. **用量纵深与移动输入**:per-session token/成本估算(适配器读各家 JSONL token 字段,Conductor/ChatML 当卖点);手机端截图注入(桌面 Composer 附件链路复用,走 WS 通道)。
5. **工程债(并行)**:macOS 签名/公证与 Windows 签名——「首次打开要手动放行」对增长是真实摩擦,优先级随分发规模上升。

## 五、P2 战略题(列出,不拍板)

- **跨 agent @ 委托**(codeg 式):广播已覆盖「同一输入喂多引擎」的主场景,@ 委托是编排升级,牵涉结果回流与合并,需先想清是否走多 agent 协同路线。
- **定时/自动化调度**(cron/RRule 跑 agent):CodePilot/palot 有,轻量需求真实(挂机跑批量任务),与通知闭环天然配套。
- **内嵌浏览器预览**(cc-haha):前端工作流强需求,但重量级;可先评估「打开系统浏览器 + 端口识别」的轻形态。
- **provider preset**(cc-switch 50+ 一键导入):与「客户端非切换器」定位冲突,沿 09-06 结论谨慎;P0-2 的接力体验会自然覆盖大部分诉求。
- **跨 CLI 会话迁移**(ShellTeam session-file 翻译):高风险脆弱层,远期。

## 六、明确不追(护城河与反向清单)

- **幕布内消息气泡/Markdown/Diff 二次渲染**:竞品全线放弃 raw 模式恰是用户回流的理由,不跟。
- **Generative UI / 会话流内 widget**:同上,破坏 PTY 保真主轴。
- **强制登录/账号体系/云订阅**:竞品最大差评主轴;本地优先 + 设备配对是定位级选择。
- **重 UI 换肤式「现代化」**:Warp 的教训是 AI 功能过度堆砌稀释核心体验([HN](https://news.ycombinator.com/item?id=49174816));增强一律发生在幕布之外的既有纪律继续守。

## 七、对 similar-products(09-06)的状态校正

| 09-06 记录 | 2026-09-26 实况 |
|---|---|
| 差距:Prompt Enhancer / AI 润色 | **已落地**(prompt-enhancer 插件 + 09-21 spec) |
| 矩阵「远程控制 = 否」 | **已落地**(手机 App M1/M2 + Web 三通道 + 自建中继一键部署) |
| 差距:审批疲劳纵深 | 部分落地(审批收件箱聚合应答);分层标记/拒绝引导仍空 → 本文 P1-4 |
| 差距:跨 Agent 委托 | 未做(战略题,本文 P2) |
| 未列入痛点维度 | 本文补全:通知断层/撞墙接力/历史检索/worktree 编排/失败分类 |

## 附:证据来源

痛点路(全部 HN 一手帖,普遍度为分析者估计):[Ask HN 并行会话](https://news.ycombinator.com/item?id=47573483) · [ChatML](https://news.ycombinator.com/item?id=47303711) · [IAXT 审批疲劳](https://news.ycombinator.com/item?id=48830666) · [Cowork 讨论](https://news.ycombinator.com/item?id=47218288) · [Running Claude Code dangerously (safely)](https://blog.emilburzo.com/2026/01/running-claude-code-dangerously-safely/) · [ShellTeam](https://news.ycombinator.com/item?id=49097325)([repo](https://github.com/sebderhy/shellteam)) · [Herdr](https://news.ycombinator.com/item?id=48756578) · [Claude Code On-the-Go](https://granda.org/en/2026/01/02/claude-code-on-the-go/) · [claude-relay](https://github.com/chadbyte/claude-relay) · [octocode 帖](https://news.ycombinator.com/item?id=47260741) · [dev.to 编排文](https://dev.to/jovan_chan_9500711396d4e6/parallel-ai-coding-agents-in-2026-how-to-orchestrate-multiple-claude-code-and-cursor-agents-3291)

竞品路:[Conductor Show HN](https://news.ycombinator.com/item?id=44594584) 及差评链([OAuth](https://news.ycombinator.com/item?id=44737387)/[闭源](https://news.ycombinator.com/item?id=44663614)/[平台](https://news.ycombinator.com/item?id=44702387)/[沙箱](https://news.ycombinator.com/item?id=47256614)/[弃用转 CLI](https://news.ycombinator.com/item?id=46758682)) · [Crystal](https://github.com/stravu/crystal)([HN](https://news.ycombinator.com/item?id=44259353)) · [Vibe Kanban](https://github.com/BloopAI/vibe-kanban)([Show HN 语境](https://news.ycombinator.com/item?id=48370360)、[Batty 视角](https://battysh.github.io/batty)) · [Omnara](https://news.ycombinator.com/item?id=44878650)/[二轮](https://news.ycombinator.com/item?id=46991591) · [Sculptor](https://news.ycombinator.com/item?id=45652806) · [Claude Code Desktop 重构](https://www.macrumors.com/2026/04/15/anthropic-rebuilds-claude-code-desktop-app/) · [Warp 差评主轴](https://news.ycombinator.com/item?id=49174816) 与 [OpenWarp](https://openwarp.zerx.dev) · [稳定性对比](https://news.ycombinator.com/item?id=48143779)
