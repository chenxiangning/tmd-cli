# 0.5.2 实施拆解(v2,经三路复审修订)

> 依据:同目录 [README.md](README.md)(规划与拍板项,含修订记录)。本文只做批次级拆解:改动面、步骤、验收、风险。
> 通用门禁见附录 C;每批独立提交,提交信息 `type(scope): 中文一句话祈使句`。

## 0. 批次总览

| 批 | 内容 | 性质 | 主要改动面 | 前置 | 依赖拍板 |
|---|---|---|---|---|---|
| F | 重扫修复:busy 震荡族 + 发送链回滚 | 码(小,1~1.5 人日) | evidence/ssSession/sessionTab/ssAnchorRail + 桩测 | 无(**先于 B1**,防 soak 判定被污染) | 否 |
| B1 | RPC 真机 soak(十场景) | 测试 | 零码,产出 soak 记录 + 缺陷单 | F | 否 |
| B2 | RPC 健壮性小修 | 码(小) | ssWatchdog/ssWarn/adoptBoot + locales | B1 缺陷单 | 否 |
| C1 | claude stream-json spike(输入+输出双侧) | 调研 | 零码,产出调研底稿 | 无 | 否 |
| C2 | claude RPC 扩容落地 | 码(新引擎,2.5~4 人日) | cli-shared 传输/reducer/types + cli-claude 声明 + locales | C1 + 拍板 2 | 是 |
| C3 | kimi via ACP 扩容(已拍板) | 码(新引擎) | cli-shared acp 三件 + cli-kimi 声明 + locales | C2 落地后(同迭代接续)+ C3 spike 工程闸 | 已拍板 |
| D1 | 假死受控复现矩阵真机跑 | 测试 | 零码,产出验证记录 | 无(与 B1 并行) | 否 |
| D2 | Rust + mobile 健壮性小修(serde/竞态/focus 线程/图片 base64/size 补拉/全量 join/CR) | 码(小) | src-tauri event_sink/render_health/proc_stream/commands_fs + mobile 三处 | serde 项在 B1/D1 证据后,其余可先行 | 否 |
| E1 | 真机验收日(存量集中焚烧) | 组织 | 零码,产出验收记录 + mobile-m2 归档 | 排期;手机项在 D2 后复跑 | 拍板 4 |
| E2 | signing 凭据接线执行 | 配置 | openspec 状态头 + workflow_dispatch 验证 | 拍板 3 | 是 |
| E3 | 首包切割(registerTabContent 懒载) | 码(中) | tab 注册面 + check-dist 体积断言 | 拍板 5(本迭代内,RC 前) | 是 |


## 批次 F:重扫修复(1~1.5 人日,先于 B1)

> v2.4 新增:三路只读重扫(前端/kernel/Rust+mobile)产出 16 条实证发现,主 fix 落本批,其余并入 B2/D2。根因族:**多步 agent 轮里每步 `session_settled` 都触发 `onBusy(false)`(piRpc.ts:244-249),下游多处消费原始 busy 边沿未走 turnLive 宽限态**。逐条已抽验源码。

1. **P1 evidence 多步轮存证失明**:evidence.ts:61-65——步间 `settled()` 清 `activeSessionId` 后,下一步 `agentStart` 空队列不重开 → 后续 `toolExecution` 全在 :86 `!sessionId` 短路,checkpoints 只记第一步。修法:`agentStart` 队列空且 `activeSessionId` 为 null 时回 `this.activeSessionId = sessionId` 一次重开。
2. **P1 中途假通知 + 计时闪烁 + send 误分支**:ssSession.ts:114-131——每步 settled 都 `promptDebt--`+`notifyTurnEnd`(多步轮中途弹「轮结束」,真结束时反而哑)+ `setBusySince(null)`(working 带每步闪烁、elapsed 归零);send() :256 闭包 `busy` 判 prompt/followUp,落在震荡 false 窗口即误走 prompt。修法:通知/busySince/send 分支/unread 沿(sessionTab.tsx:121-131,多步轮未读可 +N 虚高)**统一改走 `useTurnLive` 宽限态边沿**(现成基建,ssTurnLive 600ms 宽限即为此设计)。
3. **P2 发送链共享 catch 回滚已成功的发送**:ssSession.ts:256-274——send/followUp 成功后同链 `getState()`,其超时/进程退出进共享 catch → `promptDebt` 回滚 + `setDraft` 回填已发出文本 → 用户重发 = 重复消息。修法:catch 只挂发送 promise,evidence/getState 尾段各自 `.catch(() => undefined)`(同文件 :124-126 已有此写法先例)。
4. **P2 锚点轨流式期测量抖动**:sessionTab.tsx:145 `userBlocks` memo 依赖 `ss.blocks`(每 120ms flush 新数组)→ ssAnchorRail.tsx:70-81 每 flush 全量 disconnect/new ResizeObserver + 每用户 querySelector,长会话流式期持续 layout 抖动。修法:effect 依赖改稳定序列化键(同文件 `userTextsKey` 先例)。
5. **P3 onExit 不结清记账**:ssSession.ts:137-149 退出路径直接 setBusy(false) 跳过 onBusy 分支,`promptDebt`/`queued` 残留,retry 复用 hook 实例时旧债吃掉下一轮通知。修法:onExit 补 `promptDebtRef.current = 0; setQueued(0)`。

- 验收:桩端到端多步轮(≥3 步,模拟逐步 session_settled/agent_start 震荡):存证步步落账、OS 通知恰一次、未读恰 +1、working 计时不中途归零、发送后 getState 超时草稿不回填;`pnpm check:gate` + react-doctor 100。
- 时序:**先于 B1 soak**——场景 2(未读)/7(通知)/10(存证缺帧)的判定点全在本批修复面内,先修再 soak 结论才干净。

> 实施记录(2026-11-06):已落地并通过 review(ReviewF 结论:可收口,P1 无)——evidence 同链重挂(补 rearmSessionId 锚定链判据,幽灵 agent_start 不伪造封存)、ssTurnLive 增 startedAt、ssTurnClock 新文件(busy/busySince 纯派生 + 轮末通知恰一次 + spend/refund/clearDebt 记账)、send 分支改 hasOpenTurn + 发送链 catch 拆分、sessionTab userBlocks 内容键稳定引用;ssSession 287 行过铁则,check:gate 全绿,react-doctor 100。P2 一条转 B2-6,P3 两条随手项已修。

## 批次 B1:RPC 真机 soak(1 人日,零码)

**目标**:0.5.0/0.5.1 新体系的十场景真机清单,产出 soak 记录文档 + 缺陷单(缺陷进 B2 修复,不在本批改码)。

| # | 场景 | 步骤要点 | 判定 | 代码锚点 |
|---|---|---|---|---|
| 1 | 并行会话串写 | 同引擎同 cwd 双开 RPC 会话,各自输入草稿/重命名/静音 | 互不串写;resume 后各自成键;改静音不复活 | scoped 键 `#sessionId` 分域(0.5.1 修复回归) |
| 2 | resume 三分流 | ①已结算末轮 resume ②busy 中关 tab 再 resume ③retry 中断重开 | ①全量保留零重放 ②剪尾由重放重建 ③重放帧仍落账;**后台跑完长轮 → 未读蓝灯累加,点开激活即清** | ssSession.ts:159-161/:202-203,structuredSessionEnded.ts:79 |
| 3 | reload 收养 | RPC 会话在途长轮中 ⌘R reload webview | boot 枚举收养回接,行活/tab 回接,历史由磁盘种子补 | adoptBoot.ts:19-40/:70 |
| 4 | 结束账本 | 关 tab 产生结束行 → 点行 resume → 移除;积累 >50 条看淘汰 | 灰点行/resume/移除正确;busy 旗剪尾正确;**结束行等待审批期行黄灯可见** | kernel/structuredSessionEnded.ts(封顶 50) |
| 5 | cwd 特殊字符 | 在含 `#`/`%` 的路径下开 RPC 会话 + reload 收养 | tab id 转义无歧义,收养反解正确 | encCwd/decCwd(契约 35 §2.1) |
| 6 | 握手与看门狗 | 冷启动握手计时;构造无帧 busy:`kill -STOP <引擎pid>` 冻结输出(配方),解冻恢复 | 60s 分层不误杀冷启动;watchdog warn 行为记录(呈现升级归 B2,本批只记);staleMs 可注入加速(ssWatchdog.ts:12),真机只验 60s 不误杀 | piRpc.ts:28-29,ssWatchdog.ts:12-19 |
| 7 | 审批回路 | omp 与 pi 各跑一轮触发 confirm 卡 | 卡呈现/应答回写/超时语义;**等待期行黄灯 + OS 通知触达** | piRpcTypes.ts:44-53 |
| 8 | Windows 轮 | Windows 真机跑场景 1/3/7(0.4.4 起无 Windows RPC 真机证据);附带回验 0.5.1 welcome 依赖修复双副本(npm 副本遮蔽场景) | 同 mac 行为;welcome 修复回验过;差异记缺陷单 | — |
| 9 | 渲染/UI 面判定点 | 过一遍 0.5.0/0.5.1 视觉面:新建菜单分块/空态引导页/处理面板默认域变更/RPC 幕布宽度拖拽持久化/活轮批次折叠(窗口恒定最新 3 批含思考)/omp §n§ 标签剥除(幕布 + 只读转录)/行时间对齐(活行闲时相对时间、结束行关闭时间) | 各面与 CHANGELOG 描述一致;异常记缺陷单 | ssLiveWindow,ssCtxTags,ssCanvasResize |
| 10 | 048 时序项 | ①send 后观察 response/工具帧先后(存证缺帧风险) ②ssActions 连续重复同文 prompt 的对应关系 | 存证不缺帧;同文 prompt 各自正确归属 | 048-second-review:31-32 |

- 产出:`docs/review/2026-11-xx-052-rpc-soak.md`(场景×结果×缺陷),登记 docs/README.md。
- 已知关注点(soak 时重点看):adoptDiskSeed 读不到磁盘转录 = 静默空幕布(无提示,B2 修);帧丢弃仅首次 warn 胶囊;watchdog 一次性 warn 无出口(B2 修)。

## 批次 B2:RPC 健壮性小修(0.5~1 人日)

**目标**:把 soak 关注点中「无出口/无声」的两处升级为可操作,不动协议层;并消化重扫补充的四条小项(v2.4)。

1. **watchdog 升级**:`busy > 5min 无帧` 一次性 warn → 常驻状态条 + 两个出口(重试 retry --resume / 中断 kill),对齐 PTY 侧 canvasStall 重建的可操作思路。
   - 改动面:`ssWatchdog.ts` + `ssWarn.tsx`(呈现)+ `ssSession.ts`(出口接线)+ locales 三语。
   - 验收:单测(warn 沿/出口按钮语义)+ 桩目检(staleMs 注入加速,推帧停后 warn 呈现与出口动作)。
2. **adoptDiskSeed 空幕布如实提示**:收养时磁盘转录读不到(静默空幕布)→ 幕布内一行 warn 告知「历史不可读,仅实时内容」,不再无声。
   - 改动面:`adoptBoot.ts`(结果透传)+ 幕布空态渲染 + locales。
   - 验收:桩(无磁盘行收养)目检 + 单测。
3. **深链两处(重扫)**:①structuredSessionTabs.ts:90-94 base-tab 回落误报 `jumped` 且 jumpTranscript.ts:31 提前 return 不走 openSessionViewAtText 兜底 → needle 静默丢失;修:仅精确命中算 jumped,base 命中 sid 不符落 miss 分支。②:263-265 通知点击在 tab 已关时 `openStructuredSessionTab` 无 resume 参数开全新空会话;修:focusStructuredSessionTab 回落先解析结束账本/行快照 sessionId 带 resumeSessionId 重开。
4. **接力按钮恒灰(重扫 P3)**:ssActions.tsx:97 渲染期读 `relayOpenRef` 无订阅,挂载早于 relay 注册则永不重渲染;修:点击时再判空 + toast,或写方广播 kernel event 触发重渲染。
5. **孤儿收割范围收紧(重扫 P3)**:adoptBoot.ts:60-64 对所有非 `structured:` label 活流无条件 kill,未来 proc_stream 第二消费方会被误收割;修:kill 范围收紧到 label 为 null 或 `structured:` 前缀。

6. **follow_up 排队锚位判据(批次 F review P2 转入)**:多步轮期间排队的 follow_up,其 checkpoint 锚会被下一引擎步的 agent_start 提前消费(锚落轮 1 中段,恢复语义歪斜)。修法方向 = 把 turn_start 轮界信号接入 evidence(仅「跟随 turn_start 的 agent_start」消费队列,引擎自主步走 rearm 分支);**先采实证**:真实 pi RPC 会话跑多步轮 + 中途排队 follow_up,抓帧序确认多步轮内 turn_start 是否逐步重发,再定判据(piRpc.ts 299 行贴线,改动需同步预算拆分)。

> B2 实施记录(2026-11-06):①watchdog 已升级常驻横幅(ssWatchdog 暴露 staleSince,sessionTab StallBanner 重试/中断两出口 + 静默计时,i18n 三语);②adoptDiskSeed 增 onMiss 如实提示(命中但空转录不误报,dropResume 降级不提示);③深链两处已修(仅「确是那盘会话」算 jumped,错会话落磁盘转录查看器;通知点击已关 tab 带 resume 重开);④relay 按钮**复核不改**(relayOpenRef = kernel 闸语义,插件 activate 先于 React 挂载,风险窗口仅插件禁用,灰钮即意图);⑤孤儿收割已收紧;⑥见下。
>
> **B2-6 实证(2026-11-06,本机 pi 1.4.0 裸驱 `--mode rpc`,/tmp/b2-6-spike/capture.jsonl)**:
> - **P1 帧名漂移(已修)**:pi 1.4.0 结算帧 = `agent_settled`(整 run 一次,agent_start 亦一次),**不发 session_settled**(omp 18.x 帧名)→ piRpc/reducer 只认旧名会 busy 永不回落、活轮永不落定。已按双名先例补 `agent_settled`(piRpc + reducer + 测试)。
> - 原判据不成立:排队 follow_up 起跑轮界与引擎自主步完全同形(turn_end→turn_start,均无 agent_start;实证 50021ms 派发 = turn_start+queue_update+回显)。下一候选 = queue_update 队列长度 ≥1→0 变化,需复抓 payload;修复挂起归 B2 二轮。
> - 附带:pi 1.4.0 每 0.5~1s 广播 2 帧 extension_ui_request 心跳(150s 323 帧,非 confirm,default 分支已忽略),留观。
> - pi 1.4.0 = 单 busy 周期整 run;「逐步 settled 震荡」属 omp 18.x 形态,F 修复对两者均正确。
>
> **B2-6 二轮实证与修复(2026-11-06 晚,/tmp/b2-6-spike/capture2.jsonl(pi 1.4.0)/capture3.jsonl(omp 18.16.0)全量 payload 复抓)**:
> - **判据成立**:queue_update 载荷 = `{steering: string[], followUp: string[]}`,深度 = 数组长度和;引擎自主步(轮内 turn_end→turn_start)全程零 queue_update,排队 follow_up 起跑轮界 = turn_start 后 ~3ms 队列 1→0 变迁帧(顺序与一轮假设相反,不是「queue_update 先于 turn_start」)。omp 18.16.0 与 pi 1.4.0 帧形态完全一致(omp 已跟 pi 同名 agent_settled/agent_start 单发)。
> - **修复落地**:queue_update 原帧经 piRpc `onQueueUpdate` 透传(piRpcTypes 接口),evidence `queueUpdate()` 检测 ≥1→0 变迁消费排队锚(锚落起跑轮首);agent_start 消费保留为旧引擎回落(reset 清深度防换进程串场)。版本事实修正:omp 18.16.0 已是单 agent_start 单 agent_settled 形态,「逐步 settled 震荡」属更老 omp 18.1.x。
> - 验收:evidence.test 排队锚变迁消费/空队列不伪造/回落语义三用例 + piRpc.test 透传用例 25/25 绿;check:gate 与 react-doctor 收口见提交。

## 批次 C1:claude stream-json spike(0.5~1 人日,零码)

**目标**:本机实证 claude 双向流协议(**输入侧 + 输出侧**),产出调研底稿,作为 C2 拍板依据。输出侧只够拍「能不能接」,输入侧才够估「传输层工作量」(复审 P1-3)。

- 采集清单:
  - 输出侧:完整一轮事件样本(`system:init`(含 capabilities 原始样本)/`assistant`/`user`/`control_request`(can_use_tool)/`result`)+ 工具调用触发审批的时序 + `--resume <id>` 续会话实证 + 版本号记录。
  - **输入侧**:user 消息注入帧格式;busy 期 steering(能否追加);interrupt/abort 控制帧有无;图片输入(content blocks?base64?)实测;stdin 帧的必需字段。
- 产出:`docs/research/claude-stream-json-probe.md`(输出事件 schema 表 + 输入协议段 + 审批时序 + resume 实证);样本帧存 `docs/research/claude-stream-json-probe/samples.jsonl`。
- 判定门:①审批回路真机走通;②**输入/握手形态摸清**(具备估传输层工作量的条件);③图片输入形态明确(供拍板 2 子项)。①走不通 = C2 降级「只读幕布通道」重新拍板;②③不齐 = 补抓,不得带模糊拍板。
>
> 实施记录(2026-11-06 晚,claude 2.1.282 本机直连智谱 Anthropic 兼容端点,reclaude 代理 device_revoked 不影响协议面):②③过;**①=流内审批面不存在实证**——默认档与 `--permission-mode manual` 档均不产 can_use_tool control_request,审批需求直接 `system:permission_denied` 帧 + is_error tool_result 自动拒绝(`--permission-prompts host` 的 host 指 Agent SDK 宿主,裸 CLI 不可达)。剩余候选路 A = `--permission-prompt-tool` MCP 路由(补探 ~0.5 人日)/路 B = 降级自动批准形态,均不阻塞传输层。另两个关键实证:claude = 长驻进程多轮会话(result 逐轮收口,同 session_id,P5);图片 content block base64 端到端可达(GLM 视觉应答「Orange」,p4c)。判定门语义修正:①的「走通」在 claude 语境下 = MCP 路由补探或降级拍板,传输层动工不被阻塞。

## 批次 C2:claude RPC 扩容落地(2.5~4 人日,拍板后)

**目标**:claude 成为第三个支持「带渲染的会话」的引擎。红线:R-PTY0,proc_stream.rs 零改动。

1. **启动旗标下沉**:`CliProfile.structuredRpc` 增 `modeArgs?: string[]` 字段,PiRpcSession 的 `--mode rpc` 硬编码(piRpc.ts:76)改读 profile;omp/pi 两声明补齐同值,行为零变化。
   - 改动面:`cliProfile.ts:283` + `piRpc.ts:75-76` + `cli-omp/index.tsx:215` + `cli-pi/index.tsx:106`。
   - 验收:omp/pi 现有测试零改动全绿(行为兼容硬证据)。
2. **传输层按引擎分派**(复审 P0 修正,不可省):piRpc.ts 恒满 300 行且其握手/多路复用/审批回写全为 pi 族私有协议(piRpc.ts:82-85/:216-227/:175-181),claude 照搬连 get_state 握手都过不了。新建独立 `ClaudeRpcTransport`(或会话壳):`system:init` 事件即就绪(无 get_state)、user 消息直写 stdin、`control_response` 审批回写、无 request 多路复用;send/stats/models/commands 各能力按 C1 实测映射,无对应物给空态。
   - 改动面:`src/plugins/cli-shared/claudeRpcTransport.ts`(新)+ ssSession 编排按 profile 分派传输层。
   - 验收:transport 单测(帧路由/审批回写/握手超时);ssSession 对 pi 分支零行为变化。
3. **ClaudeRpcReducer + 类型独立成家**:`claudeRpcTypes.ts`(沿 piRpcTypes 先例)先拆,`claudeRpcReducer.ts` 落 `CliTranscriptBlock[]` 同形输出;工具行因果序、思考段、用户回显对齐 omp/pi 幕布语义。**行数预算:按 300 行铁则预写拆分(部件纯函数后拆 claudeRpcWidgets 类件),不赌贴线、不用 file-size-exempt**(豁免定位是自动生成/vendored,手写 reducer 不符)。
4. **evidence 帧归一层**(复审 P1-1):evidence.ts 消费的是引擎原始帧(`toolExecution(rec)` 只认 `toolName ∈ {write,edit}` + `args.path`,evidence.ts:30-38,喂数点 ssSession.ts:134)——claude 工具帧(Write/Edit + `input.file_path`)须在传输/归一层同形化成 pi 形态再喂 `onToolExecution`。
   - 验收(可观察口径):**checkpoints 面板出现 claude 编辑批次、足迹可深链**——不是「代码链通」的伪验收。
5. **审批回路**:`control_request/can_use_tool` → confirmCard 呈现 → `control_response` 回写,接 `answerConfirm`(ssSession.ts:36 接口位)。
6. **辅助能力空态降级**(复审 P2-5):claude 无 get_available_models/stats/commands 对应物时——模型位/思考位/上下文 chip/命令抽屉/额度 chip(QuotaChip 依赖 model 路由)逐面定义降级呈现(隐藏 or 「—」),禁止假数据兜底。
7. **cli-claude 声明**:`cli-claude/index.tsx` 加 `structuredRpc { command: "claude", modeArgs: [...stream-json 族...], resumeArgs: (id) => ["--resume", id] }`;能力门自动点亮。
8. **协议漂移防线**:spawn 前经 kernel `ipc.cliProbe` 探针(**不是** welcome 插件私有 engineProbe,跨插件 import 违规)+ `system:init.capabilities` feature-detect,未知字段降级不猜;过旧版本走 `cliPrerequisite.minVersion` 语义引导引擎卡更新;不追 token 级 delta。
9. **图片输入子拍板落地**:按拍板 2 子项执行——content-block 适配(composer 附件路径改走 blocks)or 声明不支持(附件钮降灰 + 提示)。
- 改动面另含:locales 三语(如有可见文案)。
- 回滚与摘除副作用(复审 P2):摘声明后结束账本行成死端、磁盘历史行继续让位(`isSsSessionTracked` 吃账本源)——**结束账本行渲染与磁盘行让位判据按 `profile.structuredRpc` 存在性过滤**(一行级),使回滚真正干净。
- 总验收:真机 claude RPC 会话端到端(渲染/审批卡/resume/evidence 落 checkpoints/结束账本/图片按拍板形态);`pnpm check:gate` + Rust 三件套(proc_stream 未动也跑)+ react-doctor 100 + i18n 三段核对。


## 批次 C3:kimi via ACP 扩容落地(2.5~4 人日,已拍板,C2 后同迭代接续)

> v2.1 新增(v2.2 拍板升格:大仙已决「接」;v2.3 定序:与 C2 同在 0.5.2 迭代内先后落地,不切版本)。本机实证:kimi 2.2.0 `kimi acp` = Agent Client Protocol 服务器 over stdio——双向 JSON-RPC + `permission/request` 运行审批 + `session/load` resume,是 claude 之外唯一全齐通道。ACP 是多引擎标准(grok 的 streaming-json 官方自述即「每行一条 ACP session update」同形),一套 ACP 适配可覆盖未来 ACP 系 agent,ROI 高于逐引擎私协议。

- 前置 spike(同 C1 口径,C2 落地后即刻做):本机 `kimi acp` 抓包 initialize/session/new/session/prompt/session/update/permission/request 全事件面 + 会话中追加输入(steering)与 stop 语义 + 工具事件字段名(对标 evidence 帧归一层)。判定门:permission 流与 update 事件质量实证合格才动工(拍板已给,此门是工程闸非决策门)。另抓模式档语义(默认逐项问 / -y 只问风险项 / --auto 全自动)映射到 confirmCard 的默认呈现。
- 落地(同 C2 骨架,复用其全部引擎无关层与经验):`AcpRpcTransport`(JSON-RPC stdio,request id 多路复用天然有)+ `acpRpcTypes.ts` + `acpRpcReducer.ts`(update 事件 → CliTranscriptBlock[],预算拆分同铁则)+ permission/request → confirmCard → permission/update 回写 + `session/load` 接 resume 分流 + evidence 帧归一(ACP tool_call 字段 → write/edit/args.path 同形)+ cli-kimi `structuredRpc` 声明(`command: "kimi"`,`modeArgs: ["acp"]` 族)+ 辅助能力空态(ACP 无 quota/stats 通道,chips 降级同 C2-6)。
- 顺序:C2(claude)先行落地并真机冒烟,随即 C3-spike → C3 落地,两引擎缺陷在本迭代内分批归因。C2 的传输层分派(modeArgs + 按 profile 分派)本就是为第二协议家族预留的缝,C3 是第一个消费者;ACP 适配落地后,grok(ACP update 同形只读)等 ACP 系引擎的边际成本只剩声明与 reducer 事件表。

## 批次 D1:假死受控复现矩阵真机跑(0.5 人日,与 B1 并行)

**目标**:memory #339 悬置的自愈闭环验证。矩阵:①遮挡窗口 + PTY 洪水(前台可见逐 chunk)→ 期望 init_watchdog 5s 拍检测、洪水判据降级 focus、宽限耗尽 reload,全程 ≤35s;②可见窗口深冻(挂死 rAF)→ 二击 reload 路径。核对 Rust 日志「render_health: 渲染粘死未愈(strikes=…)」(render_health.rs:159)与降级行(:180-186)。
- 产出:`docs/review/2026-11-xx-render-health-matrix.md`(两形态×观测时间线×判定);自愈失败 = 缺陷单进修复批。
- 附带:把「假死自证方法(看日志两行)」写进设置-行为 render_health 诊断面板说明文案(1 处 i18n)。

## 批次 D2:Rust + mobile 健壮性小修(1 人日,serde 项**排在 B1/D1 证据落盘后**,其余可先行)

**目标**:原双 serde 优化 + 重扫补充的 Rust/mobile 五项(v2.4)。

1. **event_sink 订阅期双 serde**(原项):订阅在场时 BUS 帧复用 emit 的序列化产物,帧形态零可见变化优先兼容。改动面:`event_sink.rs`(约 20 行)+ `web/ws.rs` 配合。
2. **event_sink 订阅竞态(重扫 P2)**:`event_sink.rs:44` 先查 `receiver_count()` 后发,ws.rs:141 订阅在连接后——计数读 0 跳过 BUS.send 的瞬间恰有新订阅者即永久丢帧(前端靠 snapshot 兜)。修法与项 1 合并:去掉 count 短路改恒 send(0 接收者时 Err 零成本)。
3. **on_focused 裸线程积压(重扫 P2)**:render_health.rs:248-260 每次 Focus 事件 spawn 4s sleep 线程,Cmd-Tab 抖动线性积压。修法:探针死限并入 init_watchdog 5s 心拍(KickState 存 probe_deadline_ms),删 spawn。
4. **手机图片上传走 JSON 数字数组(重扫 P2)**:mobile/remote.ts:217 `Array.from(bytes)` 85 万元素数组 ≈3× base64 体积,850KB 图 2.5-3.4MB 帧;`fs_write_bytes_base64` 通道现成。修法:fs_write_temp 增 `dataB64` 分支,手机改传 base64。
5. **useLiveStream 首载退避不补拉 size(重扫 P3)**:useLiveStream.ts:126-131 size 只首拍一次,失败即 80×24 错误折行最长 3s。修法:退避重拉与 page 并行补一次 sizeOf()。
6. **LiveScreen.view() 全量 join(重扫 P3)**:liveText.ts 100ms 合帧每次 `[...scrollback,...lines].join`,2000 行回看时流式期每秒 ~10 次数 MB 分配。修法:scrollback 缓存成串仅视口段增量 join。
7. **proc_stream 不剥 `\r`(重扫 P3)**:proc_stream.rs:206-210 只 pop `\n`,CRLF 行尾 `\r` 入帧。修法:再判 `buf.last()==\r` 补 pop。

- 验收:cargo 三件套;ws.rs 桩对比 serde 前后字节量;手机桩:上传帧体积断言 + size 失败重拉;桌面无订阅行为不变;E1 手机项在本批合入后复跑。
- 风险:帧契约变更需同步 mobile 解码面——无法零改动兼容则项 1 只做保守款。

## 批次 E1:真机验收日(半天~1 天,组织项)

**目标**:跨版本真机验收债集中焚烧(存量见附录 A),陪跑顺序:035 验收单 14 项(mobile)→ 041 账本余项 → 0.4.2/0.4.3 幕布四动作与 ports kill 复验 → 0.4.5/0.4.6/0.4.9 存量 → 0.5.x 由 B1 覆盖不重复。
- 产出:`docs/review/2026-11-xx-052-acceptance-day.md`(逐项勾验记录);035 单勾验状态同步回原文档;**`openspec/changes/2026-09-22-mobile-app-m2-light-interaction` tasks 勾验后归档**(其 tasks.md 9.4 明记留待大仙扫码复验后归档,本批恰是复验窗口)。
- 纪律:验收发现缺陷进修复批,当天只记不修(可归因);修复后补验;手机相关项在 D2 合入后复跑。

## 批次 E2:signing 凭据接线执行(0.5 人日,拍板 3 后)

- macOS(若拍板配置):Apple Developer 账号开通 → repo 六 secrets(APPLE_CERTIFICATE/PASSWORD/SIGNING_IDENTITY/ID/PASSWORD/TEAM_ID)→ **workflow_dispatch 手动跑 release workflow 验证**:签名/公证在 build job 内照常执行,产物落 workflow artifacts(不建任何 Release、不触 tag),下载产物本地 `spctl -a` 验公证 → 更新 `openspec/changes/2026-09-26-signing-pipeline/proposal.md` 状态头为「已启用」。
- Windows(若拍板采购):OV/EV p12 或 Azure Trusted Signing 选型 → release.yml:166-167 signCommand 接线 → 同 workflow_dispatch 验证;不采购则状态头记「维持未签(手动放行)」结案。
- **铁则(复审 P1)**:禁止用「打 test tag 建 Release」方式验证——updater endpoint 指向 `releases/latest`,test release 一旦 publish 即劫持全部在装客户端的更新通道;若确需 tag 验证,必须保持 draft 永不 publish 且全腿跑完经 `gh api -X DELETE` 清理。

## 批次 E3:首包切割(1~1.5 人日,拍板 5 后,本迭代内 RC 前)

- 依据底稿:docs/design/040-candidates/feasibility.md:50-52(React.lazy 包 registerTabContent + 两段式激活;红线 = kernel/cli-shared 静态、terminal 常驻;可懒面 = workbench/anim/git/files;预估 3718→~1600KB)。
- 步骤:tab 注册面改 lazy 装载 → 构建对比(基线 vs 后)→ `scripts/check-dist.mjs` 增主入口体积断言(防回涨)→ `pnpm check:gate`。
- 验收:构建产物数字对照写进提交信息;全插件懒载后首开功能冒烟(工作台/git/files/anim 各开一次)。
- 时机纪律:合入窗口避开 C2/C3 协议适配调试期,防性能改动与引擎适配缺陷混在归因(同迭代内择空档插队,复审 P2-3)。

---

## 附录 A:真机验收债存量清单(集中登记,焚烧于 E1)

> 来源:各评审文 record-only 段 + 041 next-steps 账本。本表是 0.5.2 的处置底单,权威记载仍在原文档。

| 来源版本 | 条目 | 状态 |
|---|---|---|
| 0.3.1/mobile M2/git59(035 验收单) | 14 项:A 配对态与钥匙串 / B LAN 基础链路 / C WAN 蜂窝(C1 切 relay 8s)/ D 韧性(D1 桥停列表保留、D2 大会话回放耗时) | **全部未勾**(docs/brainstorm/2026-10-09-035-acceptance-checklist.md:50-53) |
| 0.4.0 时点账本(041 next-steps:30) | 累积 28 项 = M2 余 6 + 0.3.5×14 + 0.3.7×6 + 0.3.8×2 | 部分与 035 单重叠,以两账并集为准 |
| 0.4.2/0.4.3 | 幕布根治真机复验四动作(文件链接/开合文件面板/关 tab/深翻后 resize);ports kill 真机复验;Scroll arm 2.5s 误捕真 alt 需真机舞步时序 | 未验 |
| 0.4.4 | Windows 真机逐项;ssSession/ssActions 时序无真机证据 | 未验(Windows RPC 部分由 B1 场景 8 覆盖;时序由 B1 场景 10 覆盖) |
| 0.4.5 | 四点目检(046-20items:69 记账) | 未验 |
| 0.4.6 | 明细展开:WebGL 开关回落 / 幕布重建阅读位 / ⌘F 回到最新条 / ⌘N 直达弹窗 / 存储管家自家类目清理钮 / 崩溃孤儿收割横幅(046-20items:70-71、046-supervisor:136) | 未验 |
| 0.4.8 | 重试预览 / WSL 写回冲突横幅 / 重启现场恢复 | 未验 |
| 0.4.9 减法批次 | A~F 六项目检 + 量化计时对比(subtraction-final-verdict:53-55;批次 D/E/F 评审各有待办,0.4.9 已发版未烧) | 未验 |
| 0.5.0/0.5.1 | RPC 体系全量 + welcome 双副本修复回验 | 由 B1 十场景覆盖(场景 8 含 welcome),不重复计数 |
| — | render_health 自愈矩阵 | 由 D1 覆盖 |

## 附录 B:留观项存量清单(record-only,本批原则 = 只并真机组,不扩面)

042 release review 现存(docs/review/2026-10-22-042-release-review.md:35,0.4.3 已收编 7):ports 二段杀宽限窗 pid 复用误杀 / kernel enforcement 键盘路径(shift+PageUp 窗内被钉回)/ findAnchorFull 重复锚文取首现行 / guard tail 只认字面 H/2J/3J 变体 / exitedReads 读失败缓存 30s(有意取舍)/ footprint 原话跳转不传 occurrence / useCkptScope 探测窗读侧不走 withEchoFallback / terminalPathLinks 逗号多文件头段死链 / 分支徽标长名溢出。

043 second polish(docs/review/2026-10-22-043-second-polish-review.md 文末 7 条,重叠加注):ports pid 复用(重申)/ guard dance 主相 2.5s 误捕真 alt / anim >32MB 合法项目误标无效 + 轮询全量重读无缓存 / checkpoints 开窗批清单闪空一拍 / checkpoints 禁用撞探测窗 Set 残留 / files 逗号路径启发式歧义。

044 review(docs/review/2026-10-23-044-review.md:24-27):anim en/ja toast 混排 / LRU 逐出无测试 / checkpoints 回落窗闪一拍等 record-only——**维持不动**。

045/046 系:045 的 2h+ 挂机内存浸泡(045-batch:24)、046 明示缓办 2 项(P2-18 远程写回 stat 伴行、P2-22 wslExec 路径转义,046-supervisor:133)——**维持 record-only**;mobile P3 复合快照(P1/P2 上线后实测再定,当前结论 = 性价比存疑)。

0.5.2 处置:**真机复验组**(guard dance 窗长、幕布四动作、ports kill)并入 E1 陪跑;045 浸泡若 E1 当天有挂机窗口顺带观察,不单开;其余维持 record-only 不动;anim 两项若后续版本动 anim 缓存时顺带,不单开。

## 附录 C:每批通用门禁

1. 前端改动:`pnpm check:gate`(typecheck + test + 架构边界 + 300 行铁则 + i18n 键比对 + kernel 盘点 + build,全链不许拆段替代);词典或 `t()` 改动重点看缺键/不对称/死键三段。
2. Rust 改动(D2 等):`cargo test && cargo clippy --all-targets -- -D warnings && cargo fmt --check`。
3. 提交收口:`npx react-doctor@latest -y` 得分 100。
4. UI 行为改动:1421 dev server + Tauri 桩目检或真窗口目检(浅色主题基准);测试绿不算数。
5. 提交用显式文件清单 `git add <files>`,前置 `git status --short` 核对不扫他人 in-flight;推送前最新树上再跑一次 check:gate(并行会话铁则)。
6. 每批 review 一篇(docs/review/YYYY-MM-DD-*),落盘即登记 docs/README.md。
7. **发版 checklist(版本收口时)**:CHANGELOG `[x.y.z]` 小节先行(缺小节 = 发版未就绪)→ package.json + src-tauri/tauri.conf.json 双处版本号 → 树上全绿(check:gate + cargo 三件套)→ 打 tag;Release 正文由 prep-release 从 CHANGELOG 注入,禁止占位文案(AGENTS §3 发版铁律)。
