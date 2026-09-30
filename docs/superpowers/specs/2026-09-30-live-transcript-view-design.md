# 活会话结构化视图(幕布|转录双视图)设计

- 日期:2026-09-30
- 状态:已实现(待真机验收)

## 背景与目标

会话查看器(session-viewer 插件)已能只读渲染磁盘 session JSONL(六族适配器 → CliTranscriptBlock → TranscriptView,极简模式可折叠每轮工作过程)。用户提出:能否在**活会话进行中**用这套结构化渲染替换 PTY 幕布显示,并按自己的意愿随意切换?

前置分析结论(2026-09-30 会话):可行且架构干净——幕布链路(PTY bytes → pty://out → xterm.js)与结构化链路(磁盘 JSONL → 适配器 → TranscriptView)天然解耦,切显示面不需要动任何 PTY 语义;askWatch 的结构化审批弹层是同一思路的先例。落地形态 = **改造 session-viewer + 会话画布双视图切换**,不新插件(渲染契约都在 session-viewer 里;新插件要么复制渲染要么把 TranscriptView 上移 cli-shared/kernel,均违规)。

目标:中央画布每会话可切「幕布 | 结构化转录」,结构化态实时跟随会话落盘内容更新;幕布保活零卸载,composer 输入面不变,PTY 链路零改动。

## 方案取舍

### 选定:画布浮层挂点 + 探测短路轮询 + 变更即全量重读

- **显示面**:kernel 新挂点 `editorCenter.canvasOverlay`(画布绝对定位浮层层,pointer-events-none 容器),MainPanel 在非平铺形态渲染;session-viewer 经 `ctx.contribute` 贡献组件。幕布 keep-alive 结构原样保留——转录视图是**覆盖**而非替换,TerminalView 不卸载不 display:none(覆盖式还避开了隐藏期尺寸塌陷一类问题)。
- **模式态**:每会话 Map(tmd 会话 id → 开关),session-viewer 插件内模块 store;会话退出经 `KernelTopics.sessionExited` 剪除。
- **数据**:1s 轮询 `ipc.fsReadTailChanged(path, 1, lastSize)` 探测(尺寸未变短路零读取),变更即 `profile.readSessionTranscript` 全量重读重建 blocks——**message 级刷新**(JSONL 是事件级追加,非 token 级,前置分析已确认为真实粒度上限)。
- **会话文件定位**:活会话 → `host.getCliSessionId(meta.id)`(IdentityLedger)→ `profile.listSessions(cwd)` 找同 id 磁盘会话拿 path(限频 3s,目录全扫有成本);文件消失则清缓存重定位。
- **渲染**:尾窗视角——live 只看尾部(首批 200 块),「载入更早」向上回溯(回溯保持滚动锚点);新内容到达且用户贴底则自动跟随,上翻即停跟。
- **能力门控**:引擎无 readSessionTranscript / shell 类会话不出浮层(内核规则:缺失显示 —,不猜测兜底);TUI 交互时刻(选择器/确认框)手动切回幕布。

### 补充:实况尾窗(2026-09-30 同日首版验收「无流式体感」)—— 2026-09-30 同日撤回

首版补 PTY 实况:轮次进行中(isTurnActive)转录底部叠「实况」块,500ms 采样 `host.outputTail`(PTY 环形缓冲),剥 ANSI + 折叠 TUI 连续重绘行后取末 14 行。**同日验收撤回**:PTY 字节 = TUI 自绘 chrome(进度条/状态行/扩展 setStatus 文本),清洁管线怎么压都是噪声(验收图:进度条残帧 + `mc: 39.1K (5%) · idle` 一类状态行),与结构化块语义冲突。流式体感的正解 = 结构化会话视图(`--mode rpc` 事件流:thinking/text delta 原地追加 + working 头计时 + 工具行预览),磁盘转录浮层回归 message 级物理上限,不再解析 TUI 语义。

### 呈现层拉齐 monocode(2026-09-30 第三轮,验收「无 loading/思考工具 UI 不对」)

数据粒度天花板(message 级)不动,呈现补齐:① live 浮层底部 working 带
(kernel isTurnActive 同源呼吸灯,`<引擎> working for Ns` 每秒跳);② 卷尾流式
观感——TranscriptView 增 streaming prop,最后一个 reasoning 块摘要脉冲、最后
assistant 正文尾光标;③ 工具行对齐 monocode:done/error 状态符(✓/✕)+ 路径
子行默认可见(monocode 图2 的 Read <path> 行)。极简分组折叠不动(tmd 既有设计)。

### 被否决

| 方案 | 否决理由 |
|---|---|
| 全新插件 | 渲染契约(块模型/极简/md 管线/适配器消费)全在 session-viewer;新插件复制渲染或上移契约到 cli-shared/kernel(准入不符)两头违规 |
| 结构化视图替换幕布(卸载 TerminalView) | 重挂 = 全量回放 + loading 遮罩(MainPanel keep-alive 注释钉死);且丢 PTY 幕布使 TUI 交互时刻无法回落 |
| 增量尾读 + 逐行增量解析(delta bytes → lineOf → append) | lineOf 解析器是各 cli-* 家族私有,增量暴露需扩 CliProfile 契约并改 7 家插件;且 pairToolResults 就地变异会破坏 React memo。全量重读在常规活会话(<几 MB)上成本可接受,粒度已是 message 级 |
| 文件 watch 事件(notify)驱动 | 需新 Rust 命令;1s 探测短路的空转成本一次 stat,对 message 级粒度足够 |
| 平铺形态也出浮层 | 浮层语义只属单会话视图;平铺多会话并排时覆盖全部列语义混乱 |

已知天花板(ponytail 注释钉在代码里):变更即全量重读,超大转录(8MB+ agent 风暴)每秒全量解析约百毫秒主线程成本;升级路径 = 契约暴露 per-family lineOf 做尾窗增量解析。

## 验证

- 纯逻辑单测:模式 store(切换/订阅/退出剪除)、尾窗切片(tailWindow)、实况行清洁(liveTailLines)。
- 门禁:typecheck + vitest + check:arch-boundary + check:file-size + build。
- 1421 桩目检:浮层入口门控、切换往返、轮询跟随、载入更早滚动锚点、极简开关联动。
- 真机 tauri:dev 目检留大仙验收(本次不提交)。
