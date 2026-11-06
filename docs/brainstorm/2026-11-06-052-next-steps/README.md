# 0.5.2 规划:RPC 体系 soak + 稳定性收口 + claude 引擎扩容(待拍板)

> 日期:2026-11-06。基线 = 0.5.1(f40914f2)。**修订:三路复审后 v2;v2.1 勘正 kimi 通道;v2.3 全批次进 0.5.2 不切版本;v2.4 三路代码重扫补 16 条实证发现(新批次 F + B2/D2 扩项),并清除已实施内容。修订点见文末修订记录。**
> 调研方法:四路并行证据盘点(RPC 体系代码侦察 / 稳定性欠账定位 / 工程内务盘点 / claude·codex·opencode 等引擎结构化协议外部调研)+ 三路换角度复审;结论均带 file:line 或来源链接,关键结论经独立复核。
> 实施拆解(批次/改动面/验收/附录账本)见同目录 [implementation.md](implementation.md)。

## 1. 结论(先行)

0.5.2 的正确姿势**不是加功能,是「soak 新体系 + 收口稳定性 + 内务拍板」,能力面只开一条口子(claude RPC 扩容)**。理由:

1. RPC(带渲染的会话)体系是 0.5.0 才落地、0.5.1 还在修串写/标签泄漏的全新生面,自动化测试再全也没有真机 soak 证据;
2. 调研证实:假死自愈链、幕布 rAF 合帧、mobile 视图节流等此前的「性能债」代码面已全部落地,只剩**验证**欠账(真机矩阵从未跑过、035 验收单 14 项全未勾、真机验收账跨版本累积 28+ 项);
3. claude 的 stream-json 是当前唯一「双向 JSONL + 运行时审批回路 + 成熟 resume」三全的引擎通道;但经复审修正,扩容成本不止协议层 reducer——**传输层握手/多路复用/审批回写也是 pi 族私有协议,需按引擎分派**(§2.2);
4. 减法批次 A~I 刚收口(2026-11-05,批次 I 裁决「保留但冻结扩张」),不宜再开新插件面。

## 2. 现状盘点(0.5.1 时点,代码实证)

### 2.1 对上轮口头评估的四处修正(经事实复核)

| 上轮说法 | 复核后事实 |
|---|---|
| 假死自愈闭环代码欠账 | **代码已完整**:render_health.rs 常驻 watchdog(5s 拍/15s 判死/kick 阶梯 focus→reload/60s 冷却/洪水 256KB/5s 判据 + FLOOD_GRACE 180s 宽限,:261/:100/:41-44)+ 前端 rafFallback(1s 轮询,`render_health` 命令上报)+ floodGauge 滑动窗 + terminalStream rAF 合帧(:79-96)。**只剩真机受控复现矩阵未跑** |
| web 桥 PTY 双序列化是放大器 | 仍在但已收敛:ws 订阅闸(web/ws.rs:97「pty://out/* 不再无差别广播」)+ event-gap 带内信号;残余 = **订阅期每 chunk 两次 serde**(event_sink.rs:30-37),属优化项非缺陷 |
| grok/kimi/dsh/qoder-cn 无头生成欠账 | oneshotArgs 已覆盖 **7** 家:omp/pi/opencode/claude/codex + qoder 双版(qoder-cn 经 qoderPlugin 工厂同源声明,qoderPlugin.tsx:81-83,2026-10-26 接入——初稿误记回落 TUI 系过期结论,复审勘正);grok/kimi/dsh 回落 TUI 是 0.4.5 实证裁决,维持不动 |
| mobile 列表查询 P1 待做 | **P1/P2 已于 2026-10-05 落地**(HomeScreen 视图节流 + sessions:changed 事件驱动),仅 P3 复合快照留观(已登附录 B) |

### 2.2 RPC 体系引擎无关性(扩容成本的结构性证据)

分层已把引擎知识压到**协议层四处**(复审补数:第四处是请求-应答协议本身;kernel 投影/账本/收养/看门狗仍全部引擎无关):

1. 启动旗标 `--mode rpc` 硬编码于 PiRpcSession(piRpc.ts:76);
2. reducer 帧类型全是 omp/pi 事件名(piRpcReducer.ts:104-118);
3. 审批协议 `extension_ui_request confirm` + respond 回写(piRpcTypes.ts:44-53,piRpc.ts:175-181);
4. **传输层握手与多路复用**:get_state 即就绪探测(piRpc.ts:82-85)、request 只认 `response` 帧(:216-227)、respond 回写 `extension_ui_response`——claude 无对应物,照搬连握手都过不了(60s 超时直落 error 态)。另 piRpc.ts 恒满 300 行(头注自认),不可往里塞 flavor 分支。

引擎声明面 = `CliProfile.structuredRpc { command, resumeArgs }`(cliProfile.ts:283),omp(cli-omp/index.tsx:215)/ pi(cli-pi/index.tsx:106)各一行;能力门按声明存在性自动点亮(NewSessionEntry.tsx:16,契约测试钉住)。

### 2.3 引擎通道外部调研结论(2026-11)

| 引擎 | 通道 | 双向 | 运行时审批 | resume | 结论 |
|---|---|---|---|---|---|
| **claude** | `-p --input/output-format stream-json` | 是 | `control_request/can_use_tool` → stdin `control_response` | init 事件带 session_id,`--resume <id>` | **首选,难度低-中**;风险 = 官方明言非稳定 API → 防线 = 启动探针 + `system:init.capabilities` feature-detect + 过旧引导引擎卡更新(`cliPrerequisite.minVersion` 现成语义);**不做版本 pin**(仓库三条更新路径均恒装最新,pin 结构性不成立) |
| codex | `app-server`(JSON-RPC 2.0 over stdio) | 是 | 逐 turn 审批 + turn/steer | thread/resume | 二梯队,难度中;`codex proto` 已是官方弃路勿接,exec --json 单向且 schema 无版本标记(0.144 静默漂移实证) |
| opencode | server 模式(HTTP + SSE) | 是 | `/session/:id/permissions/:id` 完整审批 | session API 齐 | 二梯队;**形态不同构**(本地 HTTP client 而非子进程泵),需独立适配层 |
| **kimi** | **`kimi acp` = ACP 服务器 over stdio**(2.2.0 本机实证);另有 `--print --output-format stream-json` 单轮 | **是**(ACP 双向 JSON-RPC) | **是**:ACP `permission/request` 运行时审批(另有 -y Ask-When-Needed/--auto 模式档) | **是**:`session/load` + `-S/--session`/`--continue` | **可接,ACP 家族首选**(v2.1 勘正:初判「审批链缺失」只看了 --print --afk 路线,漏 `acp` 子命令);须经 spike 实证 permission 流与 update 事件质量 |
| grok | headless `--output-format streaming-json`(官方自述「每行一条 ACP session update,agent 原生格式」)+ `--always-approve`/预授权规则;无 ACP 服务模式(1.0.62 实证) | 半(单轮 emit) | **无**(headless 仅 always-approve/allow 规则) | 有(-r/--continue/--fork-session) | 转录渲染可(ACP 同形 update),交互审批缺失,二梯队;若 ACP 家族落地,可作 AcpReducer 的只读消费方评估 |
| gemini/qwen | stream-json 单向只读 | 否 | 无 | 有 | 单向流 + gemini 产品线迁移期 + qwen fork schema 已偏离,不接 |

来源链接清单(2026-11-06 调研):claude headless 官方文档、BubbleCode stream-json 协议实证、codex app-server 官方文档、codex issue #3447/#41216、opencode server 文档、x.ai/kimi/gemini/qwen 官方文档。

### 2.4 工程内务事实

- **signing**:macOS 六个 APPLE_* secrets 接线就绪(release.yml:170-190,缺失整组跳过降级 ad-hoc),Windows 未签等证书采购拍板;openspec `2026-09-26-signing-pipeline` 状态 = 部分落地,阻塞在大仙侧凭据(Apple Developer 账号 + 6 secrets;Windows OV/EV p12 或 Azure Trusted Signing 二选一)。updater 验签(minisign)与代码签名是两条独立链,可并行推进互不阻塞。
- **首包**:vite.config.ts 零 manualChunks、无 chunk 体积监控;DesktopApp 之内无懒边界(main.tsx 只有平台样式 + 壳两级懒载)。现成设计底稿 = docs/design/040-candidates/feasibility.md:50-52(React.lazy 包 registerTabContent,红线 kernel/cli-shared/terminal 静态,预估首包 3718→~1600KB)。
- **真机验收债**:47 文档 ~190 处「真机目检」提及;账本口径 0.3.5=14 项 → 0.4.0 自报累积 28 项;035 验收单 14 项全部未勾(:50-53)。除主账外还有三组易漏存量:0.4.5 四点目检、0.4.9 减法 A~F 六项目检 + 量化计时、0.4.6 明细(WebGL 开关/幕布重建阅读位/回到最新/⌘N/存储管家清理钮/孤儿横幅)——均已补进 implementation.md 附录 A。
- **留观项**:无集中登记处,散在各评审文 record-only 段;附录 B 已收 042/043/044/045/046 与 mobile P3 存量及处置口径。

## 3. 主线规划(五批)

| 主线 | 一句话 | 性质 |
|---|---|---|
| F 重扫修复(先行) | busy 震荡族(多步轮存证失明/中途假通知/未读虚高)+ 发送链回滚 + 轨测量抖动——三路只读重扫 16 条实证发现的主修面,先于 soak | 码(小) |
| B RPC 真机 soak | 并行串写/resume 三分流/reload 收养/结束账本/守望平权/渲染面等十场景真机清单 + 健壮性小修(watchdog 出口、空幕布提示) | 测试 + 小码 |
| C claude + kimi 引擎扩容 | claude:spike 抓包(输入+输出双侧)→ 传输层分派 + reducer(预算拆分)+ evidence 帧归一 + 审批回路;kimi:同骨架走 ACP 协议族(C2 后接续) | 码(新引擎 ×2) |
| D 稳定性验证 | 假死受控复现矩阵真机跑 + Rust/mobile 健壮性小修(双 serde/订阅竞态/focus 线程积压/图片 base64 通道等;serde 项排在 soak 证据后) | 测试 + 小码 |
| E 工程内务 | 真机验收日集中焚烧(含 mobile-m2 归档)+ signing 拍板执行(workflow_dispatch 验证)+ 首包切割(拍板 5) | 码 + 组织 |


批次内改动面/验收标准/风险见 implementation.md。

## 4. 推进顺序(全部批次落 0.5.2 当前迭代,不切版本)

依赖即顺序,同迭代内按以下链推进,不按版本分摊:

1. **F 重扫修复先行落地**(P1×2:多步轮存证失明、中途假通知/计时闪烁;P2:发送链回滚、未读虚高、轨测量抖动)——B1 soak 场景 2/7/10 判定点全在修复面内,先修再测结论才干净。
2. B1 soak + D1 假死矩阵**并行**开跑(零码,产出证据);B2/D2 非证据项随 F 之后可先行,serde 项等证据落盘。
3. C1 claude spike(无前置,可立即做)→ C2 claude 落地 → 真机冒烟 → C3-spike(工程闸:permission 流 + update 事件质量)→ C3 kimi 落地。两引擎缺陷分批归因,同迭代内先后合入。
4. E3 首包切割(拍板 5 后随时插队,RC 前完成);E2 signing 凭据到即接;E1 验收日排在尾部(存量焚烧 + 本迭代新增项复验,含 B1/D1 记录归档)。
5. RC 门:全部批次完成 + soak/假死记录落盘 + 附录 C 发版 checklist(CHANGELOG 先行 + 双版本号)。

## 5. 不做清单(本版明确不做)

- codex RPC 接入(proto 死路,app-server 留 C 批之后评估;exec --json 不当主通道)
- opencode RPC(server 形态需独立泵适配,单独立项)
- kimi ACP 接入(升为候选,见拍板项 6;grok 维持不做:headless 无交互审批)
- claude 版本 pin(与仓库三条更新路径结构性冲突;探针 + feature-detect + 过旧引导已够)
- stripAnsi 逐行链改写(activityWatch/askWatch 证据分类侧,受契约 #79/#95 管辖,风险大收益小)
- RPC 置顶/归档/全局审批箱(D3/D4 裁决维持,视使用反馈)
- 新插件面(减法批次 I「冻结扩张」裁决有效)
- grok/kimi/dsh 无头 oneshot(0.4.5 实证回落 TUI,维持)

## 6. 待大仙拍板项

1. ~~**版本切分**:方案甲 / 方案乙~~ **已拍板(2026-11-06 大仙:全部进 0.5.2 当前迭代,不切版本)**;§4 改为迭代内推进顺序。
2. **claude 扩容立项**:已随「全进 0.5.2」确认,C1 spike 先行(本机抓包 claude stream-json 双向流**含输入侧协议**,0.5~1 人日)。**子项:claude RPC 图片输入**——content-block 适配 or 声明不支持 + UI 降级(C1 证据齐后随主拍板定)。
3. **signing 凭据**:Apple Developer 账号($99/年)+ 6 secrets 配不配;Windows 证书买(OV/EV p12 或 Azure Trusted Signing)或不买(维持 SmartScreen 手动放行现状)。决策后经 workflow_dispatch 验证(不建 Release,见 implementation.md E2),更新 openspec 状态头。
4. **真机验收日**:集中陪跑时间窗(存量清单见 implementation.md 附录 A,28+ 项 + 三组易漏存量 + 0.5.x 新增)。
5. **首包切割**:是否按 040-candidates 底稿立项(registerTabContent 懒载,预估 -2.1MB),本迭代内 RC 前完成 / 不做。
6. ~~**kimi ACP 二号引擎**~~ **已拍板(2026-11-06 大仙:接)**:`kimi acp`(2.2.0)提供双向 JSON-RPC + permission/request + session/load,与 C2 同迭代先后落地(C2 落地后即刻 C3-spike,工程闸:permission 流与 update 事件质量实证)。ACP 是多引擎标准(一套 AcpRpcTransport/AcpReducer 可覆盖未来 ACP 系 agent,grok streaming-json 亦同形)。

## 7. 风险与红线

- **R-PTY0 不破**:claude 扩容全部走前端协议层(proc_stream 通用泵 + cli-shared 传输/reducer),Rust session 链零改动;kernel 投影文件的双消费方先例声明照旧。
- **claude stream-json 非稳定 API**(官方明言):防线 = 启动探针(经 kernel `ipc.cliProbe`,不走 welcome 插件私有面)+ `system:init.capabilities` feature-detect + 未知字段降级不猜;过旧版本走 `cliPrerequisite.minVersion` 语义引导引擎卡更新;不追 token 级 delta(`--include-partial-messages` 不接,降帧)。
- **传输层第四处硬编码**(复审 P0):C2 第一步就做传输层按引擎分派,claude 走独立 transport(init 即握手/stdin 直写/control_response 回写/无多路复用),估算已计入。
- **300 行铁则**:piRpc.ts 恒满 300、piRpcReducer.ts 287——claude 新件一律预算拆分(claudeRpcTypes.ts 独立成家,沿 piRpcTypes/piRpcWidgets 先例),不赌恰好贴线、不用豁免头注。
- **soak 期缺陷纪律**:批次 B 发现的缺陷一律进修复批,不在 soak 清单里顺手改码,保持验证与修复分离可归因。
- **D2 时机纪律**(复审 P2-4):web 桥 serde 优化动的是单源扇出共享面,排在 B1/D1 证据落盘之后合入;E1 手机项在 D2 合入后复跑,防回归污染 soak 结论。
- **发版通道保护**:任何验证不得以 publish Release 方式进行(`releases/latest` 是全部在装客户端的更新源);E2 验证走 workflow_dispatch 产物。

## 修订记录

- v2(2026-11-06,三路复审):①§2.1 oneshot 覆盖 7 家勘正(qoder-cn 工厂同源已接,初稿误记);②§2.2 硬编码三处→四处(补传输层握手/多路复用/审批回写,C2 增传输层分派步骤,人日上调);③删「版本 pin」改探针+feature-detect+过旧引导;④C2 补 evidence 帧归一层与可观察验收、图片输入子拍板、辅助能力空态降级、reducer 拆分预案、回滚搁浅副作用处置、locales;⑤B1 增守望平权与渲染面判定、场景 6 构造配方、welcome 双副本回验、048 两时序项;⑥附录 A 补 0.4.5/0.4.9/0.4.6 三组存量,附录 B 补 044/045/046/mobile P3;⑦E2 验证改 workflow_dispatch(护 releases/latest);⑧E1 补 mobile-m2 openspec 归档;⑨附录 C 补发版 checklist;⑩行号勘误(渲染粘死 :159 / installRafFallback :106 / adoptDiskSeed :70 / useTurnWatchdog :12)。

- v2.1(2026-11-06,用户追问「kimi 能加吗」触发):本机实证 kimi 2.2.0 有 `kimi acp` 子命令(ACP 服务器 over stdio,双向 JSON-RPC + permission/request 运行审批 + session/load resume)——§2.3 kimi 行从「审批链缺失,不接」勘正为「可接,ACP 家族首选,须 spike 实证」;grok 1.0.62 实证无 ACP 服务模式(headless 仅 always-approve),维持不做但注明其 streaming-json 即 ACP update 同形;新增拍板项 6(kimi ACP 二号引擎,建议 0.5.4 评估)。

- v2.2(2026-11-06,大仙拍板「kimi 可行,更新实施文档与示例」):拍板项 6 关闭(接,0.5.4 主线);implementation.md C3 由候选升格为正式批次(spike 工程闸保留,0.5.3 期间择机);主线 C 行改双引擎;方案甲补 0.5.4 = C3;E3 择版避让 0.5.4;UI 示例稿(docs/design/052-ui-changes.html)补 kimi 菜单行与降级形态。

- v2.3(2026-11-06,大仙定调「全部内容进 0.5.2 当前迭代;锚点轨已实施,不再重新规划」):删版本切分方案甲/乙与「0.5.3/0.5.4」全部表述,§4 改为迭代内推进顺序(依赖即顺序);拍板项 1 关闭;主线表移除 A 行,锚点轨降为「前置:在途提交」(implementation.md 同步:A0 批次降为前置节,C3/E3/C2 时机全部改为本迭代内);kimi(C3)与 claude(C2)同迭代先后落地。

- v2.4(2026-11-06,大仙指示「删已实施干扰内容 + 重新检查代码补充待优化」):三路只读重扫(前端 structured-session+session-viewer / kernel+cli-shared / Rust+mobile)得 16 条实证发现入库——新增批次 F(busy 震荡族:evidence.ts:61 多步轮存证失明 P1、ssSession.ts:114 中途假通知+计时闪烁+send 误分支 P1、:256 发送链共享 catch 回滚 P2、sessionTab.tsx:121 未读虚高 P2、ssAnchorRail 流式期 ResizeObserver 重建抖动 P2、onExit 不结清记账 P3;**先于 B1**);B2 并入深链两处/relay 恒灰/孤儿收割收紧;D2 扩为 Rust+mobile 健壮性(订阅竞态/on_focused 线程积压/图片 base64 通道/size 补拉/全量 join/CRLF);文档清除全部已实施内容与「已实施」字样(UI 示例删锚点轨整节重编号,规划/拆解删前置节)。
