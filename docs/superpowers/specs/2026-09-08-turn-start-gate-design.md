# 会话状态机:轮次开启闸(关 tab 的已了结会话不被异步噪音重跑生命周期)

- 日期:2026-09-08
- 状态:已落地(实现随本 spec 提交)

## 背景与目标

实证缺陷(大仙实测报告):很多已查看过的历史会话,关闭 tab 之后还会重新走一遍
状态生命周期(灰 → 绿呼吸 → 蓝),又变成未查看。

根因链(调查记录见会话):「关 tab 不杀会话」(sessionTabs 设计使然,tab × 仅摘除)
+「锚定终生有效」(conversationStarted 是 PTY 寿命级)+「轮次开启无因果门槛」
(已锚定会话的任意字节都 `activeTurns.add`)三者叠加 —— omp/pi 常驻 TUI 的异步字节
(resume 后 hook/dreamer/更新横幅/MCP 消息)在关 tab 后到达即开新一轮,结算时
`isViewing` 恒 false(关 tab 的会话不再被查看),必然落未读。`closeOtherSessionTabs`
/`closeAllSessionTabs` 一次把多个已锚定会话打入「永不在看」态,故呈批量复发。

用户语义裁定(本轮明确):**关 tab 时真实未完成的任务必须继续在后台运行,跑完
照常标未查看**;只有「已了结」的会话关掉后才不该被噪音点亮。

目标:噪音不误标,且不削弱在途任务与 ssh/shell 长任务的完工通知能力。

## 方案取舍

**选定:轮次开启闸(activityWatch.ts onOutput 前置判定)。**
新轮次开启 ⟺ tab 还开着(`getSessionTabs().includes(id)`,容量挤除视同关)
或 有未应答用户写入(`awaitingTurn`:首写置位、下一轮次结算清除)
或 该轮次本就在途(闸只卡开启,不卡延续)。
此外闸仅适用 CLI 会话:ssh/shell「输出即活动」是既定语义
(2026-09-04-ssh-plugin-design),远端长任务(make 静默数分钟后输出完工)
关 tab 后必须照常开轮标未读,经 `noiseGated` 谓词按 `SessionMeta.kind` 豁免。

- 关 tab 时在途/待答任务 → 照常推进、结算标未读(通知权保全);
- 已了结会话关 tab 后噪音 → 不开轮、不推进活动钟、不亮灯、不发结算事件
  (turnSound 天然静音,运行区不聚集);
- tab 重开(activeSessionChanged → trackOpen)即恢复正常语义。

**否决:关 tab = 软结束(摘除锚定)。** 把在途任务的通知权一起切掉,违背用户
语义裁定,第一轮提出后被明确否决。

**否决:写后时间窗放行(GRACE 常量)。** 慢首字节(排队 + 长思考)超窗即漏标;
awaitingTurn 无时间猜测,首字节迟到任意久都放行。

**已知取舍(接受,不堵)**:

1. 打字排队后立即关 tab,且 CLI 在前后两轮间静默 >2s:第二答案不重复标
   (omp 排队即时提交,间隔 <2s 链成同一轮,实际极难命中)。
2. CLI 答案中途静音 >2s(静默长命令)分段:首轮结算已标/已看后,关 tab 态下
   后段不再重复标 —— 首轮通知已在,内容在幕布,不少东西。
3. 用户写入后 CLI 完全无输出(卡死):awaitingTurn 不清,关 tab 后迟来字节
   仍会开轮标未读 —— 语义上可辩护(「你有个没得到应答的输入」),不加定时器。

## 改动面

- `src/kernel/activityWatch.ts`:`awaitingTurn` 集合 + `ActivityWatchHost` 加
  `hasOpenTab`/`noiseGated` 谓词 + onOutput 开启闸 + 结算/移除/复位三处清理。
- `src/kernel/hostWatches.ts`:装配两谓词(hasOpenTab 读 sessionTabs;noiseGated
  按 kind 豁免 ssh/shell)。与 sessionTabs 的模块级循环仅有运行时延迟调用,安全。
- 测试:`host.unread.test.ts` 补 4 条(噪音挡闸/在途照标/迟到首字节/重开恢复),
  新建 `activityWatch.test.ts` 钉谓词矩阵(含 ssh/shell 豁免);activityWatch 与
  unread 两 fixture 接 `bootSessionTabs(host.events)` 对齐真实接线。
- host.ts 零改动(298 行,贴 300 红线,谓词装配全部落 hostWatches)。

## 验证

- `pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build` 全绿。
- 新增回归测试在修复前必败(噪音开轮三条断言全反向),修复后通过;
  在途任务/ssh 豁免两条钉保留行为。
