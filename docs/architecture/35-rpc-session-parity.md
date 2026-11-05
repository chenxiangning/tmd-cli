# 35 · RPC 会话体系对齐(左栏投影 + 生命周期平权)

> 落地:2026-11-05,六批次(commits a96469ab / be9a2f94 / ac6b8e6f / bcefd234 / 092c8554 / be5a0cb3)。
> 规划与决策记录:docs/brainstorm/2026-11-05-rpc-session-parity-plan.md(D1-D6 全按推荐项)。
> 本文只沉淀**契约**;实现细节见各文件头注。

## 1. 铁律回顾(R-PTY0 / R-ISO*)

RPC(结构化)会话与 PTY 会话**两套体系互不影响、入口隔离**:

- Rust PTY 数据链零改动:session 注册表 / session_list / activityWatch / readopt / sessionRestore 不含任何 structured 知识。
- RPC 会话的全部呈现走**前端投影**,不进 PTY 会话表(2026-09-30 spec 否决路线不复活)。
- 入口三分区:新建菜单 PTY 网格 / 带渲染的会话 / 远程与其他;左栏 RPC 分区内嵌于
  工作区卡片(图 2 结构,见 2.1a),不再独立置顶;点击行为各自激活各自 tab。

## 2. 契约

### 2.1 kernel/structuredSessionTabs.ts(唯一事实源)

- tab kind = `structured-session`,id = `structured:{profileId}:{cwd}`;resume 重开
  叠会话判别后缀(`#cliSessionId`)—— 同工作区同引擎可并行多个 RPC 会话(PTY parity,
  2026-11-05 真机反馈收口);存证/收养反解(label/账本副键)只认引擎 + cwd 二维。
  cwd 段做 `%`→`%25` / `#`→`%23` 转义(encCwd/decCwd):尾部 `#` 恒为后缀分隔符,
  cwd 含 `#` 不再歧义(组装两处锁步,解析统一 structuredSessionTarget)。
- **行投影律**:tab open 即出行(`subscribeEditorTabs` 驱动);运行态(phase/busy/
  busySince/waitingConfirm/sessionId/unread/userTexts)由 structured-session 经
  `noteStructuredSessionRow` patch 广播;快照不可变(subscribable)。
- **未读律**:因果 = busy true→false 沿(sessionTab 记账);激活 tab 即读
  (setActiveTab 单一出口,kernel 订阅清零)。
- 启动路径三态,经 payload 可选字段携带:新会话(无)/ boot 收养(`adoptStreamId`)/
  磁盘行 resume(`resumeSessionId`,tmd.ss.last / rpcids / 结束账本记忆)。
- **覆盖层自有键**(批次 5):`tmd.ss.title.*` / `tmd.ss.mute.*` / `tmd.ss.last.*`
  —— key = `{profileId}:{cwd}`,与 PTY 的 sessionTitles/sessionMutes 零共享。
- 双消费方先例:structured-session(广播)+ workspace(分区渲染)。

### 2.1a 结束账本 + 唯一呈现面(2026-11-05 真机反馈收口;图 2 结构定稿修订)

- **唯一呈现面**:RPC 行(活/结束)只在**工作区卡片内的「带渲染的会话」小节**
  呈现(StructuredSessionSection,行按 `cwd === workspace.root` 归属;图 2
  结构:工作区内区分终端会话与带渲染会话),不再有左栏全局置顶分区。形态沿革:
  初版 = 全局分区(D1-a);工作区内嵌行曾实施后回撤(与全局分区双份渲染);图 2
  结构定稿 = 回撤全局分区、内嵌成为唯一呈现面,无双份问题。
- **孤儿兜底**:无 workspace prop 的 StructuredSessionSection 只渲染 cwd 已不
  属于任何在册工作区的行(工作区被移除后的在途 RPC 会话不丢呈现面;常态
  渲染为空)。列表层分割 = 在册 RPC 会话的磁盘行让位
  (`isSsSessionTracked`:活行绑定 ∪ resume 目标 ∪ 结束账本),分区移除记录后
  自动回落引擎磁盘历史(徽标 + resume 点按仍可用)。
- **结束账本**(kernel/structuredSessionEnded.ts,自有键 `tmd.ss.closed`,封顶 50):
  已握手会话关 tab 瞬间由行投影订阅捕获快照(profile/cwd/sessionId/title +
  busy 旗 = 关闭时轮在途,resume 剪尾判据),分区存续渲染(灰点 + 「已结束」);
  点行 = resume 重开,行 X = 移除;重启仍在(PTY parity:PTY 结束会话留注册表/
  磁盘历史)。未握手壳不入账(无 resume 出口)。

### 2.1b 磁盘种子剪尾律(PiRpcReducer.seed keepTail)

- 判据 = **末轮是否在途**(`hasOpenTurn`:turn_start 起、session_settled 止),
  不是「resume 一律全量」:
- **已结算末轮 + resume(keepTail=true)**:磁盘转录是纯已结算历史,引擎 18.x
  `--resume` 全程零重放帧(2026-11-05 真机探针实证:握手只出 ready/扩展 UI 帧),
  剪尾 = 单轮会话种子变空、多轮丢末轮 —— 全量保留。
- **在途轮(keepTail=false,默认)**:活流收养 / retry 中断重开 / busy 中关闭后
  resume(payload `resumeUnsettled`,结束账本 busy 旗随行)—— 引擎将重放在途轮
  消息帧,种子带未完成轮会被整轮再写一遍,剪掉由重放重建。
- 分流接线:adoptDiskSeed 按 `!adoptStreamId && !resumeUnsettled` 传旗;
  ssSession retry 构造期种子按捕获时 `hasOpenTurn` 传 `seedKeepTail`;
  磁盘行「继续对话」入口经 `isClosedSsBusy` 查账本补旗(新建菜单「重开上次」
  入口 2026-11-05 撤除,tmd.ss.last 记忆本体保留供磁盘行判别)。

### 2.2 proc_stream detach 泵 + label(Rust)

- spawn 可带 `label`(消费方语义,`structured:{profileId}:{cwd}`);registry 持有,
  `proc_stream_list` 枚举透出。
- **emit 失败不再杀树**:webview 失联(reload/崩溃)= 读丢行防管道积压,子进程
  存活至 boot 收养;孤儿兜底 = app 退出钩子 kill_all(RunEvent::Exit)。
- boot 期前端**枚举收养替全杀**(main.tsx 的 kill_all 退役):structured label
  反解 → 开 adopt tab(订阅既有流 + get_state 握手,不新 spawn);无 label 流
  逐个 kill(等价旧语义,只清孤儿)。失联窗历史由磁盘转录后置种子补
  (adoptDiskSeed;读不到静默空幕布)。

### 2.3 存证闭环(批次 6)

- 进程 exit → `evidence.settled()` 封悬锚(此前不封口)。
- retry --resume 续跑 → `reset(sessionId)` 保身份与在途工具集,重放帧仍落账
  (此前 reset 全清 = 重放盲区)。

### 2.4 健壮性

- 握手超时 60s 分层(getState 可传 timeoutMs);稳态请求 30s 不变。
- 轮次看门狗:busy >5min 无帧 → 一次性 warn(ssWatchdog;传感器 = 前端帧沿)。
- 帧丢弃观测:parse 失败(半行/截断)首次即 onDroppedFrame → warn 胶囊。
- PiRpcState.version 协议留位(get_state 若带);UI 消费待字段名实证。

## 3. 修改规则

- 改行投影/未读语义/结束账本 → 先读 kernel/structuredSessionTabs.ts +
  kernel/structuredSessionEnded.ts 头注与测试(structuredSessionTabs.test.ts /
  structuredSessionEnded.test.ts 是行为基线)。
- 改种子剪尾语义 → 先读 PiRpcReducer.seed 注释与 adoptBoot 分流测试;
  resume 全量 / 收养剪尾的分流不许对调(2026-11-05 关闭重开丢历史事故)。
- 改 proc_stream 泵/label/枚举 → 保持「emit 失败 ≠ EOF」不变;kill_all 只允许
  app 退出钩子调用。
- RPC 覆盖层永不接 PTY 服务(sessionTitles/sessionMutes/sessionPins);
  反之 PTY 面不得出现 RPC 语义。
