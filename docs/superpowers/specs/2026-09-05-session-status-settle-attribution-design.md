# 会话状态标签:结算归因修正 + SIGWINCH 重绘抑制窗

日期:2026-09-05
状态:已落地(0892e6a)

## 背景与目标

左侧会话列表的状态标签(运行时 / 会话结束-未查看 / 会话结束-已查看)由 kernel `activityWatch.ts` 的内存状态机驱动:用户首写锚定对话 → 输出推进活动钟 → 静默 >2s 结算一轮 → 结算瞬间未被查看的会话标未读(蓝)。

缺陷(2026-09-05 深度调查实证,调查记录见本文件「实证依据」):

1. **结算归因滞后(a)**:轮次结束靠「输出静默 >2s」判定,而未读归属看的是**结算那一瞬间** `isViewing(id)`。用户亲眼看着回答打完、在 2s 检测窗内切走,结算时已不在场 → 误标「会话结束-未查看」+ 响结束音。切换越频繁,命中该窗口的概率越高,观感就是「频繁切换历史会话会重新激活状态生命周期,重新打一遍标签」。
2. **SIGWINCH 重绘误燃(b)**:已锚定的空闲会话收到真实 resize(拖 composer 分隔条后的下一次切换会触发 stage 重放;开/关文件预览 tab 改变中栏宽度;窗口缩放)→ SIGWINCH → TUI 整屏重绘(实测 omp 一次重绘 = 560KB 输出突发)→ 活动守望把重绘当成新一轮对话,生命周期完整重跑。

目标:两种误报都消灭,且不削弱真实回答的未读提醒能力。

## 实证依据(调查时已验证的事实)

- 切换会话本身对 PTY 零扰动:Chromium 全栈 mock(真前端 + mock IPC)实测,普通/快速/换档切换只发同尺寸 `session_resize`,被 `pty.rs` 幂等去重拦截,零 `session_write`。
- 锚点无泄漏:真实 omp 会话日志灌真 xterm,48 条自动应答(DA/CPR/DECRPM/OSC/kitty/XTVERSION)全部被 `terminalReports.ts` 覆盖;回放输入闸工作正常。
- 真实 omp 空闲 60s 零输出;一次真实 SIGWINCH(50→49 行)→ 560KB 整屏重绘突发。
- 对照实验:无新输出时连续 8 次快速切换,标签纹丝不动。

## 方案取舍

### (a) 结算归因修正 —— `activityWatch.ts` 一处语义改动

**选定:最后一字节到达瞬间判定。** `onOutput` 记录 `lastOutputViewed = isViewing(id)`;结算时 `unviewed = !isViewing(id) && !lastOutputViewed && exists(id)`。

- 看完答案才切走 → 最后一字节到达时正在看 → 不标未读、不响结束音(用户已知情,提醒是噪音)。
- 只看开头就切走的长轮次 → 最后一字节到达时没在看 → 仍正确标未读。

**否决:轮次期间「曾查看过」即免标。** 长轮次只看开头就离开的场景会被误判为已读,未读提醒失效 —— 漏报比误报恶劣。

### (b) 重绘抑制窗 —— `activityWatch.ts` + `host.ts` + `TerminalView.tsx`

**选定:resize 因果抑制窗。** 重绘与回答在字节流上不可区分,但重绘一定由我们自己发出的 resize 触发 —— 这是可利用的因果信息:

- `TerminalView` 的 `ipc.sessionResize` 直调改走新增的 `host.resizeSession(id, cols, rows)` 薄封装;host 转发 IPC 前同步调 `activity.onResized(id)` 记时间戳。
- `onOutput` 内:锚定会话在 resize 后 **1s 抑制窗**内的输出不推进活动钟、不进轮次、不标未读(输出缓冲/Ask 检测等其他消费方不受影响,照常收字节)。
- 已知取舍(写入 `activityWatch.ts` 头注释):resize 后 1s 内恰好完整到达的短回答会被整段吞掉,漏一次未读提醒;需要「用户正在改尺寸」与「整个回答 <1s」同时成立,概率极低,且回答稍长就只晚亮 1s、不受影响。

**否决:前端同尺寸 resize 短路**(每次 mount 少发 2 次无效 IPC)。纯性能治标,不修症状,Rust 侧已有幂等去重兜底;保持 diff 最小,不做。

**否决:按输出内容识别重绘帧。** 全屏重绘与真实回答在字节流上原理性不可分(现有头注释已论证),任何启发式都是新一轮误报源。

## 改动面与验证

改动:

- `src/kernel/activityWatch.ts`:加 `lastOutputViewed` 记录(a);加 `lastResizeAt` + `onResized` + `onOutput` 抑制窗(b);`onSessionRemoved`/`resetForTest` 同步清理;头注释补新取舍。
- `src/kernel/host.ts`:加 `resizeSession` 薄封装(转发 `ipc.sessionResize` + `activity.onResized`)。
- `src/kernel/TerminalView.tsx`:`syncSize` 改调 `host.resizeSession`。
- `src/kernel/host.test.ts`:补回归测试 ——
  1. (a) 输出期间正在查看、结算前切走 → 不标未读、结算事件 unviewed=false;
  2. (a) 只看开头就切走(最后一字节到达时不在看)→ 仍标未读;
  3. (b) 锚定空闲会话 resize 后 1s 窗内输出 → 不点亮、不结算;
  4. (b) 窗后输出 → 正常点亮结算。

验证:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`;再用 Chromium mock(真前端 + mock IPC)端到端目检:锚定 → 输出 → 结算前切走不再误标未读;resize 窗内注入输出不点亮。
