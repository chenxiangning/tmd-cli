# 08 会话生命周期状态机(activityWatch)契约

- 日期:2026-09-11(首版)
- 状态:生效中 —— 本文件是该状态机的唯一完整契约入口;02-code-architecture §4 只留摘要。

## 0. 定位与核心哲学

会话呼吸灯/未读/运行态是 tmd-cli 的**核心基础**:侧栏状态标签、tab 条圆点、运行区聚集、
composer 发送门控、结束提示音、checkpoints 封口、本地插件对话即变,全部由它派生。它也是
历史上**被改坏次数最多**的模块 —— 事故账本(§4)列了七次。复盘结论只有一条:

> 每次翻车的根因相同:拿「展示层状态」当因果信号。宽限期(时间猜测)、tab 开关
> (UI 布局)、静默(缺席证据)都不是「用户发起了对话」的证据。字节流上「有输出」与
> 「对话进行中」不可区分,唯一可靠的因果只有两条:**用户写入**(awaitingTurn)与
> **已凭用户写入开启的在途轮次**(activeTurns)。

一切设计由此展开。状态机唯一实现在 `src/kernel/activityWatch.ts`;UI 一律经
`host.isUnread / isTurnActive / getLastActivityAt` 门面读取,禁止各自再实现一份。

## 1. 状态模型

每会话四态(`plugins/workspace/utils.ts resolveSessionStatus` 派生,输入均为内核门面):

|态|条件|呈现|
|---|---|---|
|none|`lastActivityAt === 0`(首写闸未锚定)|不出签不亮灯|
|running|距上次输出 <2s|绿呼吸|
|unread|轮次已结算且末字节到达瞬间未被查看|蓝呼吸 + 组内置顶(`compareLiveSessions`)|
|viewed|轮次已结算且已查看|灰|

消费方全清单(改动状态机前先核对影响面):

|消费方|读什么|用途|
|---|---|---|
|SessionRows / SessionStatusLabel|lastActivityAt + isUnread|侧栏行状态签|
|RunningZone / useCliSessionGroup / revealSession|isTurnActive + isUnread|运行区候选与排序|
|SessionTabBar|isUnread / isWaitingConfirm|tab 圆点(蓝=未读,绿=Ask)|
|composer promptGate|isTurnActive|轮次进行中禁发送|
|turnSound|turnSettled 事件|结束音(延迟确认,响不可自愈)|
|checkpoints index.tsx|turnSettled / promptSent|轮次账本封口|
|localPlugins|turnSettled|对话即变自动重扫|

Ask「等待确认」徽章是 **askWatch 独立通道**,与呼吸灯正交,不受本状态机闸门影响。

## 2. 不变量(违反任何一条 = 回归)

- **I1 对话锚定**:呼吸灯只认用户发起的对话。`host.writeSession` 的真实用户输入是唯一
  锚定入口(`onUserWrite`),锚定前一切输出不推活动钟、不进轮次、不标未读、不发
  turnSettled。锚定 = PTY 寿命级(纯内存,随 webview/PTY 消亡,重载后回 none 是既定语义)。
- **I2 开轮只认因果**:CLI 会话开新轮 ⟺ `awaitingTurn`(有未应答用户写入)或本就在途。
  tab 开关、窗口焦点、会话是否被选中**都不是**开轮条件(2026-09-11 收紧的直接产物)。
- **I3 归因锚定末字节**:结算时未读归属看「最后一字节到达瞬间」是否被查看,不看结算瞬间。
- **I4 闸拦即幂等**:噪音被任何一层闸挡下时,活动钟/三态/轮次全部不动,状态保持已查看 ——
  闸的实现是 `return false` 早退,绝不允许「挡了但偷偷推钟」。
- **I5 通知权不被 UI 剥夺**:在途轮次(含关 tab、容量挤除、webview 重载后 readopt)照常
  推进、照常结算标未读。写完即关 tab 的首字节迟到经 awaitingTurn 放行。
- **I6 ssh/shell 豁免**:「输出即活动」是既定语义(远端长任务完工必须通知),轮次开启闸与
  空闲重绘闸都经 `noiseGated`(按 `SessionMeta.kind`)对其放行。
- **I7 磁盘回放字节永不进 appendOutput**(06 文档红线):历史字节进主链路会同时误开轮、
  误置未读、误升级 Ask、误触 EditWatch。
- **I8 synthetic 回传不算首写**:焦点/鼠标/终端查询应答(terminalReports 识别)照写 PTY
  但不进 `onUserWrite`;回放期由 terminalInputGate 直接丢弃。

## 3. 闸门矩阵(onOutput 判定顺序)

|序|闸|治什么|判据|钉它的测试|
|---|---|---|---|---|
|1|首写闸|spawn 横幅/resume 回放误亮|`conversationStarted` 未置位即挡|host.turnSettled.test.ts|
|2|空闲重绘闸|空闲 spinner/状态栏原地自绘吊住结算、永挂「运行时」|剥 ANSI 可见骨架(`[\p{L}\p{N}]`)在最近 6 帧窗内复现,或骨架为空;ssh/shell 豁免|activityWatch.test.ts「空闲重绘闸」组|
|3|轮次开启闸|已了结老会话被异步噪音重跑生命周期|`!activeTurns && !awaitingTurn && noiseGated` 即挡|activityWatch.test.ts + host.unread.test.ts「实证缺陷」|
|4|重绘抑制窗|本应用自发 resize 引发 SIGWINCH 整屏重绘(实测 omp 560KB 突发)|`resizeSession` 时戳后 1s 窗内输出不进活动语义|host.activityWatch.test.ts|
|结算|归因|看完回答 2s 窗内切走被误标未读|末字节到达瞬间 `isViewing` 快照|host.activityWatch.test.ts|

用户新提问(`onUserWrite`)清骨架窗,防跨轮次逐字符全等的真实输出被闸 2 误判。

## 4. 事故账本(为什么「经常被改坏」)

|日期|症状|根因|修法|教训|
|---|---|---|---|---|
|~09 上旬|无对话历史会话点开亮灯走生命周期|旧版「spawn 宽限期」用时间猜用户在场,静默退出后的 resume 迟到消息照样开轮|宽限期整体废除,改首写闸(I1)|**时间窗不是因果** |
|09-05|看完回答 2s 内切走被标未读;频繁切换放大|未读归属看结算瞬间 isViewing|归因锚末字节(I3)|快照时刻选错=语义翻转|
|09-05/08|已锚定空闲会话 resize 后整屏重绘误燃新一轮|重绘与回答在字节流上不可区分,但有自发 resize 的因果|重绘抑制窗(闸 4)|有因果信号就别猜|
|09-08|批量:关 tab 的老会话被 hook/dreamer 字节重跑绿→蓝|锚定终生 + 开轮无门槛|轮次开启闸(初版:「tab 已关且无未应答写入」才挡)|方向对,豁免条件埋雷 →|
|09-11|同症状复发:**tab 常驻开启**的老会话照样被重跑|初版闸把 `hasOpenTab` 当开轮豁免;老会话 tab 一挂几天,异步字节(含每分钟变的相对时间戳 = 新骨架,闸 2 拦不住)整闸绕开|删 hasOpenTab 豁免(I2),开轮只认 awaitingTurn/activeTurns|**UI 状态不是因果** —— 同一缺陷类第 4 块补丁前,先质疑豁免条件本身|
|09-11|侧栏标签永挂「运行时」、三态全失效|omp 空闲期状态栏 ≈2.8KB/s 持续自绘,轮次永不静默结算|空闲重绘闸(骨架复现判据)|「有输出」≠「在对话」要靠内容熵区分|
|09-11|历史会话点开即走完呼吸灯|回放期 xterm 重新应答历史内容里的终端查询,应答被视同首写锚定|terminalInputGate + synthetic 标记(I8)|锚定入口必须只通真实用户输入|

## 5. 修改规则(review 清单)

1. **新增/修改开轮条件**:条件只能是用户因果(awaitingTurn/activeTurns)或明确豁免圈
   (I6)。出现「tab / 焦点 / 选中 / 时间窗 / 静默时长」即驳回,本表 §4 就是判例。
2. **同症状复发 ≥3 次** → 停止打补丁,审查闸的豁免条件与锚定入口(09-11 先例:病灶
   是豁免本身,删条件比加条件好)。
3. **新消费方**只准走 host 门面;需要新的状态维度先改本契约再加字段。
4. `ActivityWatchHost` 五个谓词是全部依赖面(拆件防耦合);加谓词必须同步
   `activityWatch.test.ts` 的 makeWatch 矩阵。
5. **契约变更必须同步三处**:本文件、`docs/architecture/02` §4 摘要、被推翻旧契约的
   测试用例重写(NEVER 只删测试不改语义)。
6. 未读/轮次态是**纯内存**,重启即清 —— 持久化「已查看」不在本契约内,要做先立 spec。

## 6. 已知取舍(接受,不堵)

- 常驻 tab + 静默 >2s 的长工具调用恢复输出:不回绿(与噪音不可区分),内容仍在幕布,
  Ask 场景有独立徽章兜底。
- resize 抑制窗内恰好完整到达的 <1s 短回答:漏提醒一次(需用户正在改尺寸同时成立)。
- CLI 答案中途静音 >2s 分段:后段不再重复标(首轮通知已在)。
- 用户写入后 CLI 彻底无输出:awaitingTurn 不清,后来字节仍放行开轮(「有输入未获应答」可辩护)。
- webview 重载后锚定态归零:老会话要重新有用户写入才进灯语义(I1 的既定延伸)。

## 7. 验证

- 契约测试:`src/kernel/activityWatch.test.ts`(谓词矩阵)、
  `src/kernel/host.unread.test.ts`(host 集成 + 真 sessionTabs 接线 + 09-11 实证缺陷)、
  `src/kernel/host.activityWatch.test.ts`(归因/抑制窗)、`src/kernel/host.turnSettled.test.ts`(首写闸)。
- 改闸后必跑上述四件 + 全量 `pnpm test`;行为级目检走 1421 桩配方(scratchpad 2026-09-08
  活会话桩:session_spawn 有状态 + pty 输出注入回放)。
