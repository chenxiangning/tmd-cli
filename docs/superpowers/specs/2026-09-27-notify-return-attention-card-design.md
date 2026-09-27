# 回窗待办卡设计:失焦通知的最后一厘米

日期:2026-09-27 · 状态:已确认(实现随本 spec 提交)
上游:`docs/research/client-capability-gap-analysis.md` §5a(离开工位的通知断层,证据最强痛点)

## 背景与目标

notify 插件(2026-09-26 落地)已有三类失焦 OS 通知(Ask 等待/轮次结束/额度撞墙),但闭环断在最后一厘米:

- 通知通道 `kernel/ipc.sendOsNotification` 是单向 fire,桌面端点击通知至多激活窗口,不回传「是哪条通知」(tauri-notification 桌面无 per-notification 点击事件面);
- `notify/index.tsx` 的 `onFocus` 只做 `waitingNotified.clear()`(清补发去重账),回窗后「谁在等我」仍要自己逐个会话找。

目标:回窗瞬间若存在等待确认的会话,右下角弹聚合待办卡,行点击一步直达并聚焦幕布。动线 = 点 OS 通知 → 窗口激活 → 待办卡迎面 → 到现场作答。

## 方案取舍

| 决定 | 选定 | 否决与理由 |
|---|---|---|
| 呈现面 | notify 插件 `ctx.contribute("overlay")` 自持卡片(视觉与退出卡 sft 同区同语) | 复用 approval-inbox 面板脉冲:插件间 import 违反「一切贡献经 ctx 注册面」纪律;kernel 通知桥(app-shell 渲染):多一套 ref 桥,收益为零(参照 relayBridge 是为跨树按钮,此处无此需要) |
| 触发 | window focus 边沿 + `wasBlurred` 闸(首启不弹)+ `host.isWaitingConfirm` 现查扫等待集 | OS 通知 click 回传路由:桌面平台无此事件面,做不了;回窗自动切换会话:劫持用户意图(回窗可能另有所指),只引导不自动跳 |
| 行点击 | `host.setActiveSession(id)` + `getTerminalHandle(id)?.focus()`(approval-inbox `gotoAndFocus` 同款两行) | 代发作答/拒绝键:各 CLI 键位语义不一,发错 = 批错操作(M2 评审 A2 拍板,桌面同律) |
| 收卡 | 全部行解决(turnSettled/退出)或手关;聚焦期新增 ask 边沿入卡 | TTL 自销:回窗卡是待办不是提示,倒计时消失与目的相悖 |
| 时长显示 | 不显示(卡片职责是跳转;时长深度看板在审批收件箱与看板分区) | 复刻 inbox `since` 追踪:同事实两处记账,漂移风险无收益 |

标题解析链与 SessionTabBar / approval-inbox / composer sendPlan 同源(手动命名 > tab 快照 > meta 标题 > 短码);该链已是仓内第 4 处消费,抽取下沉 kernel 另行立项,本卡沿既有注释惯例注明同源。

## 验证

- 单测:returnCard store(开卡/移除/清空收卡/聚焦期入卡/未开卡 no-op)+ 呈现面 renderToStaticMarkup(行/标题/计数/空态 null)。
- 门禁:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build` + react-doctor 100。
- 1421 桩目检:失焦 → ask 注入 → 聚焦回窗 → 卡上屏 → 点行切激活 + 幕布聚焦 → 作答清位行消退。
