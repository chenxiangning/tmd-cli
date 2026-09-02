## Why

tmd-cli 托管的 CLI 会话弹出 Ask 提问、权限确认等阻塞面板时,现有提醒只有一瞬提示音
(add-ask-sound)——声音过去之后,哪个会话正卡在等用户,列表上毫无迹象。多会话并行时
用户必须逐个点开翻找。需要把「等待确认」变成会话行上的持久标签(复刻参照:深绿底
亮绿字胶囊,随会话行展示,作答即消)。

## What Changes

- Ask 检测从 askSound 的第二 PTY 观察者形态**上收为内核状态仓** `kernel/askWatch.ts`,
  进入 `host.appendOutput` 主链路:一次检测两处消费(`askDetected` 事件 → 提示音;
  `host.isWaitingConfirm` → 列表标签),并继承 host 的存活守卫
- 新增内核事件 `askDetected`;`askSound.ts` 退化为纯播放管线 + 事件消费端
  (与 turnSound 消费 turnSettled 对称),触发语义从「每轮一次(时间窗)」变为
  「每次等待一段一次(状态边沿)」
- 会话列表活会话行与全局置顶区的活绑定行打「等待确认」胶囊标签(绿色,同呼吸灯绿
  色板);用户写入(选择/回车/发送,统一走 `host.writeSession`)即清除
- 状态纯内存,随会话消亡清除;不持久化、不跨会话泄漏

## Capabilities

### New Capabilities

- `ask-waiting-badge`: 会话等待用户确认的状态检测、内核暴露与列表标签呈现

### Modified Capabilities

（无 —— ask-notification-sound 的需求场景全部保持成立:重绘不重复播放、
作答后新提问再次播放;仅内部触发机制从时间窗去重改为状态边沿）

## Impact

- 新增:`src/kernel/askWatch.ts`(检测 + 等待状态仓)、`src/kernel/askWatch.test.ts`
- 修改:`src/kernel/host.ts`(组合 AskWatch,≤500 行铁则内)、`src/kernel/events.ts`
  (askDetected topic)、`src/kernel/askSound.ts`(检测上收后瘦身为播放管线)、
  `src/kernel/askSound.test.ts`(检测用例随迁)、`src/main.tsx`(注释校准)
- UI:`src/plugins/workspace/SessionList.tsx`、`src/plugins/workspace/PinnedSessions.tsx`、
  `src/styles/workspace-sessions.css`(`.thread-ask-badge`)
- 架构边界不破坏:新模块不 import `@tauri-apps/*`(R3)、kernel 不 import plugins(R1)
- 不做:等待会话列表置顶排序(未读置顶已覆盖"需要关注"语义)、标签页栏打标(YAGNI)、
  设置开关(标签是状态呈现不是打扰源,零成本常开)
