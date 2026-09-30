# 结构化会话(RPC 驱动,omp/pi 先行)设计

- 日期:2026-09-30
- 状态:已实现(前端门禁全绿;真机验收留大仙——Rust 有改动,tauri:dev 须重启)

## 背景与目标

活会话转录视图(2026-09-30-live-transcript-view-design.md)验收反馈:无流式体感。实验定案(2026-09-30,本机 omp 18.4.4 实证):

1. monocode 的实时输出 = spawn `omp --mode rpc`(pi 同协议)子进程**自驱动**,NDJSON 事件流 token 级到达(实测单轮 thinking_delta×43 + text_delta×13 + toolcall/execution 帧 + session_settled);
2. **观察者不成立**:第二进程 `--resume` 同会话挂旁,驱动进程跑轮时观察者收 **0 实时帧**——RPC 无 attach/watch 语义,谁发 prompt 谁收流;
3. **磁盘无 delta**:PTY 会话 JSONL 整条落盘(全事件类型 census 实证)。

结论:PTY 会话不存在任何 token 级结构化数据源;monocode 式实时 = **必须由 RPC 进程驱动会话**。目标:新增「结构化会话」形态——不走 PTY,composer 经 RPC 发 prompt,转录 token 级流式渲染;**PTY 代码零改动**(用户红线)。MVP 覆盖 omp/pi(同协议);claude(ACP)/codex 等协议各异,后续逐家。

## 方案取舍

### 选定:Rust 通用流式子进程原语 + cli-shared RPC 客户端 + feature 插件中央 tab

- **Rust 通用原语 `proc_stream`**(内核不理解任何 CLI 语义,对齐 proc_communicate 的定位):`proc_stream_spawn`(command/args/cwd/env → id)/`proc_stream_write`(id,data)/`proc_stream_kill`(id)/`proc_stream_kill_all`(webview 重启兜底清孤儿);事件 `proc://stream/{id}/out|err`(stdout/stderr 文本块)+ `proc://stream/{id}/exit`(code),走既有 plugin:event 通道(pty://out 同款)。
- **kernel/ipc.ts** 暴露上述四个命令与 listen 助手(R3 唯一 import 点纪律不变)。
- **cli-shared/piRpc.ts**(准入:omp+pi ≥2 家消费同一协议):NDJSON 帧客户端(ready/response 多路复用/事件回调)+ 事件→CliTranscriptBlock 增量 reducer(thinking_delta→reasoning 块追加、text_delta→assistant 块、toolcall_*/tool_execution_*→tool 块、session_settled 收轮)。协议知识全在插件侧。
- **feature 插件 `structured-session`**:中央 tab(registerTabContent,session-viewer/daily-journal 先例);引擎选择(仅声明 `structuredRpc` 的 profile)+ 会话转录(复用 session-viewer 的 TranscriptView,极简联动)+ 自带输入区 + 中止 + 审批回路(extension_ui_request confirm → 内联批准/拒绝按钮 → extension_ui_response;**不自动批准**)。
- **CliProfile 新可选字段 `structuredRpc?: { command; args }`**:能力声明制(oneshotArgs 同款先例);cli-omp/cli-pi 各注册一行,插件按声明门控。
- 生命周期:tab 关闭 = kill 子进程;webview reload 后 boot 期 `proc_stream_kill_all` 清孤儿(活轮丢失可接受,历史在磁盘);tab/模式态随内存态消亡。

### 被否决

| 方案 | 否决理由 |
|---|---|
| 观察者 resume 旁挂 PTY 会话 | 实证零实时帧;RPC 无 attach 语义 |
| PTY 会话双进程共写(RPC resume 后发 prompt) | 两进程同时 append 同一 JSONL,交错损坏;TUI/RPC 内存态不同步 |
| 改造现有 PTY 会话为 RPC 驱动 | 触碰 PTY 红线;且丢幕布回落能力 |
| proc_communicate 复用 | one-shot(stdout 收割/超时即杀),无长驻双向流 |
| 结构化会话进 host 会话表/sessionTabs | 内核会话表以 Rust PTY 注册表为源;前端虚拟会话需动 readopt/收割/列表全链,MVP 不值;中央 tab 形态零内核会话面改动 |

## 渲染层修订(2026-09-30 同日,验收「思考未流式可见」反馈)

首版把流喂给为落盘快照设计的 TranscriptView(思考块默认折叠),token 级数据到了
却不可见——「没有 loading/流式/精美结构」的差评根因。修订:turnStart 切分
(reducer 记录当前轮首块下标)把渲染分两段——落定历史走 TranscriptView,流内活轮
走 LiveTurn 专用渲染器:working 头(`<模型> working for Ns` + 中止)、思考单行脉冲
摘要(点击展开全文,monocode ActivityThinkingRow 同语义)、首帧未到 shimmer
「思考中…」、正文 markdown + 末尾光标脉冲、工具行盲文 spinner/✓/✕ + 标签 +
预览子行 + 可展开输出。结算零跳变(同形块切 TranscriptView)。

## 流式链路复核与工具展开律(2026-09-30 三修,验收「无流式观感/工具展示差」反馈)

真 omp 子进程 + 假 ipc 层驱动真 PiRpcSession 的探针实证:delta 逐帧进 blocks
(thinking/text delta 均达,growing≥8 判据过)——数据层无罪,病在呈现层。协议补充
实证:①信封是 typert 型(`{type,id,...}`,非 jsonrpc method);②事件子类型在
`message_update.assistantMessageEvent.type/delta`;③`message_start` 会有 role=custom
系统噪声帧先行(reducer 忽略);④`tool_execution_update.partialResult.content[].text`
是工具实时输出增量流。修订:工具行改 monocode 自动律——运行中自动展开实时输出
(尾 40 行钳制),完成/出错自动折叠回行,点击手动接管;结构化幕布 working 带蓝点
换九宫格 spinner(与 PTY 转录浮层同款)。诊断脚本(真进程真网络)不入套件,已删。

## Reducer 根因修复(2026-09-30 四修,验收截图「无工具/思考层」反馈)

真机 blocktrace 探针定位:工具态原挂在单条消息的 live 上,而真机帧序是
assistant#1 end → tool_execution_* → assistant#2 流——工具帧到达时 live 已空,
早退丢弃 → running 行/实时输出从未建立;落定又由 piTranscriptLine 产出
tool(called)/toolResult 双重复行 + assistant 正文被解析器漏读丢失。重写: settled
数组为唯一真源,blocks 恒等 = settled + 活消息 think + 轮级工具行 + 活消息 text;
工具行提升为轮级状态机(跨消息存活,partialResult 累积即实时输出);message_end
的 toolCall 项与 role=toolResult 消息不产块(防重复);think/text 落定带流内兜底
(解析器漏读时保内容)。真机弧线复核:running 行建立 → d=13→38 实时增长 → done
翻转 → assistant 正文结算存活,单行无重复。诊断脚本已删(真进程真网络不入套件)。

## 验证

- Rust:cargo test + clippy + fmt(proc_stream 注册表/写杀/事件序)。
- 前端:vitest(piRpc 帧多路复用/reducer 增量正确性,夹具取自本机实测帧);typecheck/arch/file-size/build。
- 桩目检:1421 全链(spawn → prompt → 流式块 → 审批 → 中止 → 关 tab 收割)。
- 真机 tauri:dev 验收留大仙(PTY 回归 = 现有会话/幕布行为不变)。
