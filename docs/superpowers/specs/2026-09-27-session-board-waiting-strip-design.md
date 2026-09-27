# 看板「等待确认」置顶分区设计:跨日注意力位

日期:2026-09-27 · 状态:已确认(实现随本 spec 提交)
上游:`docs/research/client-capability-gap-analysis.md` §1a(多会话注意力的比较维度缺失)

## 背景与目标

会话看板(session-board,热力月历 + 泳道日视图)按日回溯,活会话的「等待确认」态没有独立注意力位:等待中的卡混在日格/日视图里,十个会话无从比较「谁在等、等多久」。月历落位语义是「创建日定死」(resume 不跳日),不适合承载实时注意力。

目标:看板顶部(工具栏之下、月历之上)加静态「等待确认」分区,仅非空时出现。行 = 引擎点 + 标题 + 等待时长;点击开 tab 不收板(沿用 2026-09-16 用户指令「不要自动跳转」)。

## 方案取舍

| 决定 | 选定 | 否决与理由 |
|---|---|---|
| 成员判定 | live 行 × `host.isWaitingConfirm`(内核真相位,零新增检测面) | 板行五态加 waiting 态:改 mergeLive 状态推导,牵动日格/泳道/过滤链,收益为零 |
| 时长来源 | 插件内 `waitingSince` Map:askDetected 边沿覆写记时,turnSettled/会话退出清除;边沿缺失(启动时已在等)显示「等待中」不假起走 | kernel askWatch 加 since:置位/摘除路径遍布字节/屏幕双通道 + 抑制窗 + 静默自愈,动状态机风险大于收益;approval-inbox `observeCurrentWaitings` 同款「宁缺不假」纪律 |
| 位置形态 | 静态分区插 BoardTab 顶部,不重排任何既有内容 | 行漂移有前科(批量条置顶致拖选坐标漂移);月历/日格排序一律不动 |
| 接线 | strip 独立文件,BoardTab 只加 import + 一行 JSX(该文件 299 行贴 300 铁则,同步压缩两行冗余) | 内联进 BoardTab:必破 300 行铁则 |
| 过滤语义 | 分区行取自 `filtered`(随引擎/状态 chips 过滤) | 无视过滤:与同视图其余内容口径不一致 |

时长文案与 approval-inbox `formatWait` 同串(「等待 {n} 秒/分钟/小时」),两插件各自注册同键同译,i18n 词典一致性由同串保证;跨插件抽取无注册面通道,不为此开 kernel 口子。

## 验证

- 单测:waitingSince(边沿覆写/清除/缺失 null)+ WaitingStrip 呈现面(过滤 waiting、非空渲染、全非等待返回 null)。
- 门禁:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build` + react-doctor 100。
- 1421 桩目检:等待中会话在板顶分区上屏、时长跳动、点行开 tab 不收板。
