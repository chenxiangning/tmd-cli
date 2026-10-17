# 客户端深度调研:行业格局·代码体检·功能引入评估(2026-10-17)

日期:2026-10-17(深度版终稿;同日早版 client-gap-analysis-2026-10.md 由本文取代)
状态:完成(三路调研:竞品 12 家逐个摸底 / 官方平台矩阵 / 代码级体检;拍板权在用户)
方法:① 竞品深挖 12 家(定位/功能全清单/定价/架构/社区口碑,均带来源链接);② 官方平台一手文档核对(Claude Code/Codex/Antigravity/Cursor/opencode);③ 代码级体检(包体、懒加载、测试密度、a11y、体量分布,全部实测数字);④ 对 09-26 调研逐项对账。局限:cezar/aoe/Omnara 独立社区口碑未查到;未做竞品实际上手评测。

## 结论先行

1. **行业最重信号:这个品类的商业模型集体失败了。** Vibe Kanban(28.4k stars)2026-04-10 官宣关停——「绝大多数用户是免费用户,找不到商业模式」([关停公告](https://www.vibekanban.com/blog/shutdown));Crystal 2026-02 弃维护([记录](https://aq.dev/alternatives/crystal));Omnara 从 C 端「手机指挥中心」战略转型开发者平台([repo](https://github.com/omnara-ai/omnara));活着的收费点只剩 Conductor 的云+协作($50/mo)。**对 tmd-cli 的含义:个人免费 + 本地优先的站位反而是健康的;当下是接盘 Vibe Kanban/Crystal 流失用户的窗口期,前提是跨平台(Tauri 全平台)与活体维护这两件「基本盘」持续可见。**
2. **table stakes 已全面抬高**:worktree 并行隔离、diff 行内评论回传 agent、多 CLI 支持、手机端通知+接管,在 12 家竞品里全是免费标配(Orca/Parallel Code/cezar/Emdash/Nimbalyst/aoe 无一例外)。tmd-cli 的 worktree 编排、diff 行级批注两点落在基准线之下,是硬缺口。
3. **官方平台把「单家全托管」做完了,但「跨家族」依旧无人做**:Claude Desktop 已有 pane 拖拽/浏览器自测 pane/PR 监控 auto-fix auto-merge([官方文档](https://code.claude.com/docs/en/desktop.md));Codex/Antigravity/Cursor 全是云任务+自有 agent 闭环。**没有任何一家官方能编排别家 CLI——tmd-cli 的多家族 × 原生 PTY × 本地无账号 × 跨端四轴依然成立,但窗口在收窄。**
4. **代码体检揪出四个结构性问题**:① 46 个插件全静态注册,桌面主包 3,718KB(gzip 1,137KB)无插件级懒加载;② 测试密度两极分化——cli-shared 38 测/7k 行 vs git 19 测/13k 行、workbench 32 测/15.7k 行、memory-coordinator 3 测/3.7k 行;③ kernel 29,529 行/242 文件,是最大插件的 1.9 倍,activityWatch/askWatch/theme/transcript 全住 kernel,「单插件语义不入 kernel」的红线靠自觉维持;④ a11y 覆盖约 44%(374 个 aria-label vs 846 个 button)。
5. **最值得抄的五件事**(来源见第四节评估表):Parallel Code 的 task brief「diff 外自作主张」标注、ACP 结构化审批面(aoe 路线)、Worktrunk 的 COW 构建缓存+hash_port、Omnara 的 outbound-only daemon 接入、Orca 的用量/reset 时间可视化。
6. **0.4.0 建议主题 =「基准线补课 + 结构还债」**:worktree 最小面(含 COW 缓存)、审批纵深(危险度分层+task brief)、diff 行级批注、失败回合 Retry 四个功能件,配插件懒加载、kernel 瘦身评估、死键白名单三个结构件;真机验收债清零是前置。0.5.0 再谈 ACP 评估、opencode server 接入、跨家族委托。

## 一、行业格局(2026-10)

### 1.1 官方平台矩阵(一手文档核对)

| 平台 | 客户端面 | 编排能力 | 对 tmd-cli 的含义 |
|---|---|---|---|
| Claude Code | Desktop(三 tab 之 Code)/ mobile(官方 app 内 Code tab)/ web | agent view(单屏多会话调度)、agent teams(实验,需环境变量,mailbox+共享任务列表)、cross-session messaging、dynamic workflows、scheduled tasks | **威胁最重**:Desktop 已有 pane 拖拽(chat/diff/browser/terminal/file/plan/tasks)、diff 行内评论、浏览器 pane 自动验证、PR 监控+auto-fix CI+auto-merge、usage ring(context+套餐双显)、OS 级 sandboxed Bash([Desktop](https://code.claude.com/docs/en/desktop.md)/[sandboxing](https://code.claude.com/docs/en/sandboxing)/[teams](https://code.claude.com/docs/en/agent-teams))。但全部锁 Anthropic 生态 |
| Codex | ChatGPT Desktop 内置 / IDE 扩展 / CLI / Cloud | 云任务 environment 化(机器关机可续跑、多 attempt 对比)、OS-enforced sandbox 三档([cloud](https://developers.openai.com/codex/cloud)/[sandboxing](https://developers.openai.com/codex/sandboxing)) | 云侧闭环自家;其进驻 VS Code/Cursor 恰好证明「多引擎客户端」是真需求——顺风 |
| Antigravity | App(指挥中心)/ CLI / IDE 扩展 / SDK | `/agents` 面板、后台 subagents 隔离 worktree、swarms(`/teamwork-preview`)、定时 cron sidecars、沙箱 Chromium([docs](https://antigravity.google/docs/home)) | 「agent 指挥中心」产品叙事被 Google 占了;同样只编排 Gemini 生态 |
| Cursor | Desktop/iOS/web(PWA)/Slack/REST | Cloud Agents(云端 VM 全环境、无限并行、远程桌面接管、agent URL 分享)([docs](https://cursor.com/docs/cloud-agent)) | 云威胁;本地多 CLI 面不做 |
| opencode | TUI + `opencode serve`(headless HTTP,OpenAPI 3.1)+ `opencode web`(mDNS+basic auth) | 会话 fork/revert/abort、权限应答、SSE 事件流全 HTTP 端点([server](https://opencode.ai/docs/server/)/[web](https://opencode.ai/docs/web/)) | **机会最大**:官方不做云不做移动、协议全开放,接它的 server API 是官方支持路径,也是适配器设计参照 |

### 1.2 竞品 12 家速览

| 产品 | 形态 | 协议/价格 | 状态 | 一句话 |
|---|---|---|---|---|
| [Orca](https://github.com/stablyai/orca)(Stably AI,YC W22) | Electron ADE,桌面+iOS+Android | MIT 免费;企业版另议 | 活,日更,~95k stars | agent 舰队 ADE:5 路 prompt 扇出、WebGL 终端分屏、Design Mode 点选 UI 塞 prompt、SSH worktree、diff 行级批注回传、用量/限额 reset 可视化 |
| [Parallel Code](https://parallelcode.app/) | Electron+SolidJS | MIT 免费;mac/Linux only | 活 | 十 agent 十 worktree;AI Arena 赛马、change tour 导览卡、task brief 标注「diff 外自作主张」、confidence 自评分、node_modules 符号链接进 worktree |
| [cezar](https://github.com/open-mercato/cezar) | Node cockpit,本地/VPS | MIT 免费 | 活,口碑少 | issue 驱动无人值守;YAML workflow `onFail: retry` 门禁;Variants ×N 赛马;子任务父限 4 并发「nothing auto-merges」 |
| [Emdash](https://github.com/generalaction/emdash)(YC W26) | Electron | Apache 2.0 免费 | 活 | **23 个 CLI agent 适配**同类最广;Linear/Jira/GitHub 工单直传 |
| [Conductor](https://www.conductor.build/) | macOS 原生 | Free;$50/mo Pro;$60/user Teams | 活,$22M A 轮 | Multiplayer 多人同 workspace 同时 prompt;Vercel sandbox 云;云模式 chat 消息落它家服务器(安全话术透明) |
| Crystal | Electron | MIT | **死**(2026-02 弃维护) | 首个 Claude Code 多会话 GUI;单 CLI 绑定+薄封装护城河为零的教训本体 |
| [Vibe Kanban](https://github.com/BloopAI/vibe-kanban) | Rust+Next.js | 曾 $30/mo | **关停**(2026-04) | 28.4k stars 找不到商业模式;diff 评论回传/live preview/远程访问由它定义成标配 |
| [Omnara](https://github.com/omnara-ai/omnara) | 平台(Docker 自托管) | Apache 2.0;自托管免费 | 活,转型中 | outbound-only daemon(无入站端口/SSH key)、worker 无状态+Postgres 事件日志、笔记本离线漂移 sandbox 续跑、工具三级权限 |
| [Nimbalyst](https://nimbalyst.com/)(Stravu,Crystal 继任) | Electron + wiki | MIT;Wiki Teams Beta 免费 | 活 | agent 顺手维护 wiki(决策/开放问题结构化)、Context Graph |
| [Agent of Empires](https://www.agent-of-empires.com/) | Rust+tmux,TUI/Web 双前端 | MIT 免费 | 活,曝光低 | **ACP 结构化渲染**(plan 面板/工具卡/滑动审批)、按 R+QR 零配置 HTTPS 暴露、多 repo 单会话 |
| [Worktrunk](https://worktrunk.dev/) | Rust CLI | MIT | 活(旁证) | `wt switch -c -x claude`;**APFS/btrfs COW 共享构建缓存**;hash_port 每 worktree 独立 dev server 端口 |
| Warp / Wave | 终端 | Warp 客户端已开源(AGPL);Wave 开源 | 活 | Warp:第三方 CLI agent 一等公民+remote session control+handoff 本地↔云+父子 orchestration([docs](https://docs.warp.dev/agents/));Wave:块级 needs-attention badge |

### 1.3 商业与安全信号

- **付费极难**(Vibe Kanban 关停公告原话);收款成功的两家都靠「云时长+协作」(Conductor $50/mo)或平台化(Omnara/Warp),都意味着把用户数据/工作流搬到自家服务器。
- **安全话术成为竞争面**:Conductor 明说「本地模式消息不落第三方,云模式落」;Claude/Codex 用 OS 级 sandbox(文件/网络白名单,OS 施加)做信任。tmd-cli 的「零账号+本地+局域网手机链路」在这条轴上天然干净,应在 welcome/about 把它说透。

## 二、09-26 调研对账(截至 2026-10-17)

| 09-26 判定 | 项 | 现状(证据) |
|---|---|---|
| P0-1 | 离开工位通知 | **已落地**:notify(OS 级,askDetected/turnSettled/sessionExited)+ 手机链路 |
| P0-2 | 撞墙后动作 | **已落地**:session-relay(9 家族转录+确定性摘要接力)、session-budget 预算弹窗 |
| P0-3 | 会话历史检索 | **已落地**:session-search(工作区用户消息全文) |
| P1-4 | 审批纵深 | 半落地:成批应答在;危险度分层、拒绝后引导仍无(grep riskLevel/危险度零命中) |
| P1-5 | worktree 编排 | 未落地且已表桩化(12 家竞品全有);git 面板仅识别 kind,无 add/清(grep worktreeAdd 零命中) |
| P1-6 | 失败回合分类/Retry | 未落地:仅看板扫描失败条可重试(ScanErrorBar),回合级没有 |
| P1-7 | per-session 用量 | 已落地:session-budget 独立插头 |
| P2-8 | 跨 agent 委托 | 底座出现:structured-session(omp/pi RPC)落地;Orca/Emdash/aoe 已把「任何 CLI」当卖点,窗口收窄 |
| 超预期 | 结构化会话 | RPC 驱动 structured-session 落地(09-30 spec),原调研未预见 |

## 三、代码级体检(2026-10-17 实测)

### 3.1 包体与启动

- `allPlugins`(src/plugins/index.ts)46 个静态 import——**桌面树无插件级懒加载**,全部打进主包。
- 产物实测(gate build):DesktopApp chunk **3,718.57KB(gzip 1,136.58KB)**,prod chunk 1,129KB,elk 1,462KB,图表 chunk 1,821KB;6 个 chunk 触发 vite 500KB 警告。
- boot 链(main.tsx)已是动态 import 分支(桌面/手机两树分离, procure:两树互不背字节),但桌面树内部不分。
- 对比:手机树按架构铁律动态 import 反而做了桌面没做的事。
- **含义**:启动 TTI 与内存占用随插件数线性涨;插件懒加载(registerTabContent 时才 import)是结构性收益,且架构面已有注册表,改造点集中。

### 3.2 测试密度两极分化(tests/loc,不含 test 文件的源行)

| 插件 | tests | loc | 密度判定 |
|---|---|---|---|
| cli-shared | 38 | 7,078 | **标杆**(格式解析层,应然) |
| cli-dsh | 17 | 1,847 | 好 |
| cli-omp | 14 | 3,859 | 合格 |
| git | 19 | 13,027 | **薄**(分支/worktree/batch 逻辑重) |
| workbench | 32 | 15,748 | 薄(相对体量) |
| files | 21 | 10,492 | 中 |
| intent-canvas | 11 | 7,711 | 薄 |
| memory-coordinator | 3 | 3,674 | **危险**(安装/bootstrap/检测全是逻辑) |
| wallpaper | 2 | 3,041 | 薄但低风险 |
| web-access | 2 | 1,780 | 薄 |
| structured-session | 1 | 1,179 | 薄(RPC reducer 其实在 cli-shared 有测) |
| terminal | 0 | 66 | 壳,可忽略 |

### 3.3 kernel 体量与边界

- kernel 29,529 行/242 文件(不含测试)= 最大插件 workbench(15.7k)的 1.9 倍。activityWatch/askWatch/askScreenMirror/themePresets/transcriptDigest/transport 全住 kernel——多为「跨插件契约」,但量级已到该做**分层审计**的程度:哪些是宿主机制(合理),哪些是某个 feature 的私有语义搭了便车(违规边缘)。建议 0.4.0 做一次 kernel 分区盘点(不搬家,先贴标签)。

### 3.4 其他实测

- a11y:aria-label 374 处 vs button 846 处(plugins+kernel)≈ 44%;键盘面有 shortcuts 注册表+命令抽屉打底,读屏面欠账。
- i18n:死键告警 1,068 键(动态 `t(变量)` 机制性误报,抽查证实),真死键被噪音淹没——需要白名单机制恢复信号价值。
- PTY:输出聚合批处理已有(pty_spawn.rs,OUT_AGGREGATE_MAX_BYTES 窗口),幕布性能基础健康;xterm 6 仅挂 fit/search/web-links 三 addon,**无 WebGL 渲染器**(Orca 主打「Ghostty 级 WebGL 终端」,对比之下大输出滚动性能没有护城河,值得一次基准测试再决定)。
- 移动端:4 个 view(home/session/history/git)vs 桌面 ~20 个面;73 文件。发起会话/审批应答深化是 M3 自然候选(官方 Claude mobile/Orca/Parallel Code 都验证「通知→手机 follow-up」闭环是刚需)。
- Rust 侧 10,390 行/62 文件,体量健康。
- 真机验收债 ~30 项(清单见 `docs/brainstorm/2026-10-17-039-next-steps.md`)。

## 四、可引入功能评估(价值/成本/风险/建议)

| # | 候选 | 来源竞品 | 价值 | 成本 | 风险 | 建议 |
|---|---|---|---|---|---|---|
| 1 | worktree 编排最小面:看板/会话卡「在新 worktree 起会话」+ 悬空清理 | 全员标配 | 基准线补课 | 中(git2 已在依赖,纯插件侧) | merge/PR 流诱惑,须守最小面 | **0.4.0**;抄 Worktrunk 两点:gitignored 目录(node_modules)符号链接进 worktree、COW 共享构建缓存+hash_port 端口公式(APFS 本机即收益) |
| 2 | 审批纵深:危险度分层 + task brief「diff 外自作主张」标注 | Parallel Code/官方权限模式 | 审批从「点得快」到「敢放心点」 | 中(分层=纯前端启发式;brief 需调模型生成,可后置) | 分层误报伤信任,白名单保守 | **0.4.0**(分层);brief 0.5.0 |
| 3 | diff 行级批注回传 agent | Orca/Vibe Kanban 标配 | 评审意见结构化回流,接力链路现成 | 中(files/git 已有 diff 渲染底子) | 与 checkpoints/sessionEdits 的边界要设计 | **0.4.0 排期,可顺延** |
| 4 | 失败回合分类+Retry | cezar `onFail: retry` 语义 | 失败可恢复,接力按钮有了挂点 | 小(复用 relay 转录读取器,关键词启发) | 分类不准则按钮变噪音 | **0.4.0** |
| 5 | 用量/限额 reset 时间可视化 | Orca | quota 面板从「还剩多少」到「几点能恢复」 | 小(quota 通道已有) | 各家 reset 语义不一,分家族适配 | 0.4.0 顺带 |
| 6 | Variants 会话赛马(同 prompt ×N 对比 diff) | cezar/Orca 扇出/Parallel Arena | 多 agent 议价权 | 中 | token 5 倍烧(社区实测警告);交互面新 | 0.5.0,先做「重跑对比」最小版 |
| 7 | ACP(Agent Client Protocol)结构化面评估 | aoe/Zed 生态 | plan 面板/工具卡/滑动审批的正统数据面;与 structured-session RPC 路线互补 | 调研先行 | 双轨维护风险 | **0.4.0 出调研 spec,不动码** |
| 8 | opencode server API 接入 | opencode 官方开放 | headless HTTP+OpenAPI,官方支持路径,远控/多机想象 | 中 | 另一条会话生命周期要养 | 0.5.0 评估 |
| 9 | agent wiki/决策沉淀面板 | Nimbalyst | 记忆链(omp 退出触发 ctx_memory)的结构化呈现 | 小-中 | 与 memory-coordinator 边界 | 0.5.0 |
| 10 | outbound-only daemon 式手机接入 | Omnara | 免入站端口/免 SSH key 的零配置远程 | 中-大(穿透/中继) | 自建 relay 的运维包袱——恰是 Vibe Kanban 砍掉的那类 | 观察;现有局域网+配对先够用 |
| 11 | 插件懒加载 | 自查 | 启动/内存结构性收益 | 中(注册面已备,改造集中) | 激活时序回归 | **0.4.0 结构件** |
| 12 | kernel 分区盘点(贴标签不搬家) | 自查 | 边界红线可执行化 | 小 | 无 | **0.4.0** |
| 13 | i18n 动态键白名单 | 自查 | 死键告警恢复信号价值 | 中(机械,面广) | 无 | **0.4.0** |
| 14 | WebGL 终端渲染基准测试 | Orca 对比 | 大输出滚动性能是否需要追 | 小(先测) | 结论可能是不需要 | **0.4.0 测试,按结果决定** |
| 15 | a11y 补齐(读屏标签) | — | 可及性底子 | 中(846-374 处) | 无 | 持续,随触面改 |

## 五、0.4.0 建议组合(待拍板)

**主题:基准线补课 + 结构还债。**

- 功能件:#1 worktree 最小面(含 COW/符号链接)、#2 审批分层、#3 diff 行级批注、#4 失败 Retry、#5 reset 可视化
- 结构件:#11 插件懒加载、#12 kernel 盘点、#13 死键白名单、#14 WebGL 基准、空壳归档落地(spec 已备)
- 前置:真机验收债 ~30 项清零
- 明确不做:云沙箱/remote services(Omnara/Vibe Kanban 两个反教训)、Multiplayer 团队版(无商业诉求)、强制登录

0.5.0 展望:ACP 评估结论落地、opencode server 接入、task brief、Variants 最小版、mobile M3(发起会话+审批深化)、跨家族委托(structured-session 扩家族后)。

## 六、明确不追(重申+新增)

幕布内二次渲染/消息气泡化(PTY 字节透传铁律)、强制登录与账号体系、Generative UI、自造任务调度器、云沙箱平台化与 remote services(2026-04 Vibe Kanban 已用生命验证此路不通于独立开发者)、Windows 缺席式开发(竞品 Parallel Code mac/Linux only 是可见短板,tmd-cli 三平台齐是优势要守住)。

## 方法与来源

- 竞品深挖:两路研究员子代理产出(Orca/Parallel Code/cezar/Emdash/Conductor/Crystal/Vibe Kanban/Omnara/Nimbalyst/aoe/Worktrunk/Warp/Wave,12 家,每家 3+ 独立来源,引文见正文链接;原始全文存会话记录)
- 官方矩阵:code.claude.com / developers.openai.com/codex / antigravity.google / cursor.com / opencode.ai 一手文档(链接见 1.1)
- 代码体检:wc -l/find/grep 实测(命令与数字见第三节);包体数字出自 `pnpm check:gate` build 产物清单
- 上游:`docs/research/client-capability-gap-analysis.md`(09-26)、`docs/brainstorm/2026-10-17-039-next-steps.md`(验收债)
