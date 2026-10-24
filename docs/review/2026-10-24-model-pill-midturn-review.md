# 模型位轮中可点回归修复 · 提交收口评审(换个角度)

- 日期:2026-10-24
- 状态:已收口(P2 当轮修,提交见文末)
- 对象:80c005fc「fix(composer): omp 轮中模型位恢复可点,豁免沉 profile 契约字段」(6 文件 +60/-14)
- 方式:实现者自查之外换独立评审视角——reviewer 子代理只读评审 + 主会话攻击面核查(测试有效性/跨入口一致性/远程会话边界)

## P2(当轮修)

### ask 等待期误答风险(写入会被当作答案文本)

- 链条:ask 挂起时 activityWatch awaiting 守卫扣住轮次(`kernel/activityWatch.evidence.test.ts:44-45`)→ `isTurnActive=true`,omp 豁免使模型位可点 → 点击 `sendSlash("/model")` 写进 PTY。askWatch 契约「任何写入=作答」(`kernel/askWatch.host.test.ts:119-121`):此时 `/model` 被当作 ask 的答案文本提交,且等待标签被误摘——双破坏。
- 加深一层:ask 挂超 120s 天花板轮次结算后,无豁免的 CLI 模型位同样变可点,同面可达——所以根因修不看 turn 态,只看 `isWaitingConfirm`。
- 修复(两处):
  - `composer/view/ComposerToolbar.tsx` `sendSlash` 加单点守卫 `isWaitingConfirm → return`(模型位+思考位一并护住;思考位 dsh /effort 同面);
  - `modelClickState` 加 `waitingConfirm` 参:等待期恒禁并提示「等待确认中,先在面板作答」(新 i18n 键,en/ja 同步),防「按钮可点、点了没反应」观感。
- 归属说明:此面在 2bce83d5(原始 omp 豁免)时期同样存在,b7fe1c71 一刀切禁用期间不可达;80c005fc 恢复豁免使其重新可达,属恢复行为时一并恢复的既有缺口,借本次评审补上。

## P3(记档,不动)

1. **跨入口不一致(既有)**:非豁免 CLI 轮中,模型位禁用,但 ⌘K 抽屉 /model 项(`useComposerDrawer.ts` send 路径零拦截)与输入框直敲 /model(promptGate 轮中斜杠视为控制命令,从不拦发送)都畅通。chip 闸是 affordance 约束非不变量,2026-09-13 已核对「从不禁发送」语义,promptGate ponytail 注释在案。
2. **mobile 不一致(既有)**:`mobile/StatusBar.tsx` 模型 chip 无轮次闸(点击直写 /model),比桌面宽;`MobileEngine` 无 midTurn 概念。本次未触碰。

## 查过无问题

- 测试有效性:`t()` zh 恒等回键(`kernel/i18n.ts:37-45`),默认语言 zh、无环境探测,CI 断言中文键确定;真值表 5 例覆盖全部可达分支。
- 远程引擎会话:`useActiveProfile` 按 session.engine 取 profile,远端 omp 同享豁免(远端同 TUI),远端 claude 仍被闸;远程只影响展示不污染可点性。
- 架构:契约字段在 kernel/cliProfile.ts,内核零 CLI 私有语义;composer 视图无内联插件 id 残留;sendSlash 不广播 promptSent(2026-09-08 先例不变)。

## 验证

- `pnpm vitest run src/plugins/composer/view/modelClickState.test.ts`:5/5。
- `pnpm check:gate` 全链绿(i18n 缺键 0/不对称 0,587 test files,build 过)。
- 目检(1421 桩,80c005fc 提交前已做):omp 轮中可点且写入 BP 包裹 /model;claude 轮中禁用。ask 等待期为纯函数分支 + handler 守卫,无新交互面,不再单独目检。

## 收口

- 修复提交:`fix(composer): ask 等待期模型位/思考位禁发,防误答`(本文件同批)。
- 前提交 80c005fc 的评审记录即本文件。
