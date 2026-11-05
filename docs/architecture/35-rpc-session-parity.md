# 35 · RPC 会话体系对齐(左栏投影 + 生命周期平权)

> 落地:2026-11-05,六批次(commits a96469ab / be9a2f94 / ac6b8e6f / bcefd234 / 092c8554 / be5a0cb3)。
> 规划与决策记录:docs/brainstorm/2026-11-05-rpc-session-parity-plan.md(D1-D6 全按推荐项)。
> 本文只沉淀**契约**;实现细节见各文件头注。

## 1. 铁律回顾(R-PTY0 / R-ISO*)

RPC(结构化)会话与 PTY 会话**两套体系互不影响、入口隔离**:

- Rust PTY 数据链零改动:session 注册表 / session_list / activityWatch / readopt / sessionRestore 不含任何 structured 知识。
- RPC 会话的全部呈现走**前端投影**,不进 PTY 会话表(2026-09-30 spec 否决路线不复活)。
- 入口三分区:新建菜单 PTY 网格 / 带渲染的会话 / 远程与其他;左栏 RPC 独立分区;点击行为各自激活各自 tab。

## 2. 契约

### 2.1 kernel/structuredSessionTabs.ts(唯一事实源)

- tab kind = `structured-session`,id = `structured:{profileId}:{cwd}`(单实例,D6 维持)。
- **行投影律**:tab open 即出行、close 即剔行(`subscribeEditorTabs` 驱动,无孤儿行);
  运行态(phase/busy/busySince/waitingConfirm/sessionId/unread)由 structured-session 经
  `noteStructuredSessionRow` patch 广播;快照不可变(subscribable)。
- **未读律**:因果 = busy true→false 沿(sessionTab 记账);激活 tab 即读
  (setActiveTab 单一出口,kernel 订阅清零)。
- 启动路径三态,经 payload 可选字段携带:新会话(无)/ boot 收养(`adoptStreamId`)/
  重开上次(`resumeSessionId`,tmd.ss.last 记忆)。
- **覆盖层自有键**(批次 5):`tmd.ss.title.*` / `tmd.ss.mute.*` / `tmd.ss.last.*`
  —— key = `{profileId}:{cwd}`,与 PTY 的 sessionTitles/sessionMutes 零共享。
- 双消费方先例:structured-session(广播)+ workspace(分区渲染)。

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

- 改行投影/未读语义 → 先读 kernel/structuredSessionTabs.ts 头注与测试
  (structuredSessionTabs.test.ts 是行为基线)。
- 改 proc_stream 泵/label/枚举 → 保持「emit 失败 ≠ EOF」不变;kill_all 只允许
  app 退出钩子调用。
- RPC 覆盖层永不接 PTY 服务(sessionTitles/sessionMutes/sessionPins);
  反之 PTY 面不得出现 RPC 语义。
