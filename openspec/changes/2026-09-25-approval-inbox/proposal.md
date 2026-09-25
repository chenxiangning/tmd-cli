# 审批收件箱(桌面右栏聚合应答面)

> 日期:2026-09-25 · 状态:已落地(真机目检待大仙;桩目检与门禁见 tasks.md)
> 上游:设计原型 `docs/design/approval-inbox.html`;手机侧已被 M2 覆盖(`openspec/changes/2026-09-22-mobile-app-m2-light-interaction/`,AskFloatingBadge 已落地)

## 目标

多 agent 并跑时「谁在等我」散在侧栏标签与提示音里,响应要人肉找会话。本变更给桌面一个右栏「审批」面板:聚合全部 `isWaitingConfirm` 会话(引擎、标题、等待时长、Ask 面板页脚摘录),支持直达与自由文本应答。检测零新增——纯消费 `kernel/askWatch` 既有状态位。

## 范围边界

| 面 | 做 | 不做(去向) |
|---|---|---|
| 桌面右栏 | 新插件 `approval-inbox`,注册右栏面板(摘要行自带,不挂 shell 徽标) | `FilePanelContribution` 扩徽标字段改外壳(RightPanelToolbar)——等面板价值验证后再议 |
| 应答语义 | 自由文本应答(原样 `writeSession`,回车发送)+ 直达(`setActiveSession`,经 activeSessionChanged→trackOpen 兼顾重开摘掉的 tab) | 预设「同意(y)/拒绝(n)」代发键——各 CLI 键位语义不一(1/2/y/a/n/Esc),发错键=批错操作;M2 评审 A2 已拍板,桌面同律 |
| 手机 | 不做 | M2 AskFloatingBadge(等待浮标+列表+幕布软键盘应答)已覆盖 |
| 摘录 | askDetected 边沿拉 `sessionHistoryPage` 日志尾,剥 ANSI 取末 3 行作提示 | 解析 CLI 私有面板结构/选项语义——内核不理解私有格式铁则 |

## 方案取舍

| 决策 | 选定 | 否决与理由 |
|---|---|---|
| 数据源 | `host.getSessions()` × `host.isWaitingConfirm()`,事件(askDetected/turnSettled/sessionsChanged/sessionExited)+ `useHost()` 双驱动重算 | 新增 ask 状态事件/RPC——检测已有,双份真相;侧栏「等待确认」标签同源 |
| 应答通道 | `host.writeSession` 唯一写入口(写后 8s 抑制窗天然防残影复燃,收件箱行即时消退) | 直接 `ipc.sessionWrite`——绕过锚定与 Ask 作答解除语义 |
| 等待时长 | 插件侧 since 表(askDetected 首见记时;面板后见者时长未知显示「等待中」) | askWatch 扩 since 字段——内核为 UI 展示加状态,越界 |
| 面板可见性 | 面板摘要行显示计数;侧栏标签/提示音/手机通知各自照旧 | 动外壳 tab 徽标——外壳零业务知识纪律,首批不改贡献面契约 |

## 风险

| 风险 | 对策 |
|---|---|
| 用户把应答输入框当「对话」发长文 | 输入框 placeholder 明示「原样写入会话」;Enter 即发不二次确认(与幕布敲键同风险级,不加摩擦) |
| 摘录过期(拉取后面板又重绘) | 摘录只作提示,文案标注「以会话面板为准」;turnSettled/askDetected 后续边沿刷新 |
| 后台会话日志未落盘(omp 懒落盘) | sessionLogSize 为 0 时摘录置空,行内只保留时长与跳转,不报错 |

## 验证

- 门禁:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build` + react-doctor 100。
- 单测:摘录提取纯函数(ANSI 剥离/末 3 行/截断)、since 首见不重置、answer 载荷与消退、事件边沿重算。
- 浏览器桩目检(1421 + `__TAURI_INTERNALS__` 桩):askDetected 驱动行上屏、摘录显示、应答后行消退、直达切换激活。
- 真机:`pnpm tauri:dev` 由大仙目检确认交互手感。

任务分解见 `tasks.md`。
