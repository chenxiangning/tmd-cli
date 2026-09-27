# Composer 发送二次确认设计

- 日期:2026-09-27
- 状态:已批准(大仙 2026-09-27 拍板:全部内容发送都确认;Enter 确认 / Esc 取消)

## 背景与目标

平铺模式下多个会话幕布并排,composer 发送(Enter / ⌘+Enter / 抽屉 ⚡)立即写入活跃幕布,用户经常把消息发进错误的会话且无法撤回。目标:发送落盘前弹应用内二次确认框,明确展示**发送目标**(会话标题 + 工作区 + 引擎)与**内容预览**,确认后才 writeSession。

## 方案取舍

| 方案 | 结论 | 理由 |
|---|---|---|
| A. composer 插件内门闩(选定) | 采纳 | 发送语义归 composer;改动面 = useComposerSend/useComposerDrawer 拆确认/执行两段 + 一个 settings 键;复用 GitConfirmDialog 的 portal + z-1000 + Enter/Esc/遮罩范式 |
| B. kernel `writeSession` 层全局确认 | 否决 | writeSession 服务 ask 作答、工具条 /model、终端等多调用方;kernel 不持 UI,弹层是 composer 的交互语义 |
| C. 无弹窗二段键(连按两次发送键) | 否决 | 不满足「告诉我位置和内容」;对发错**目标**无提示作用 |

豁免面(不确认):`ComposerToolbar.sendSlash`(/model、thinking 命令等工具写入,非用户内容);关闭开关时全部路径零变化。

## 设计

1. **开关**:`settings.sendConfirmEnabled`,默认 **开**;设置页行为分区(sendShortcut 同区)一行 toggle。清洗规则同其它 boolean 键(非布尔回落默认)。
2. **弹框**(composer/view/SendConfirmDialog.tsx,新文件):
   - 目标区:结构化目标卡(见 5)—— 单发 = 单卡;广播 = 「将发送到 N 块幕布」计数头 + 逐卡并列。
   - 内容区:`whitespace-pre-wrap` 原文,超长框内滚动(max-h + overflow-auto)。
   - 键位:发送键聚焦,Enter = 确认;Esc / 点遮罩 = 取消;确认后立即执行,取消则什么都不发生(草稿/输入框原样,发送管线本就在清空之前挂起)。
   - **开框键自确认防护(2026-09-27 修订)**:window keydown 监听延一宏任务挂载 —— React 离散事件同步 commit 下,开框那记 Enter/⌘Enter 在 effect flush 后仍在本帧冒泡向 window,同帧接住 = 开框即自确认(大仙实测 Enter 直发无弹框);`e.repeat` 闸防长按连发第二记即确认。
   - **挂起期模态闸(2026-09-27 修订)**:`isConfirmPending()` 期间两条发送路径(sendCurrent / sendFromDrawer)静默 no-op —— 否则弹框在屏时的第二记发送键一边被弹框 window 监听接住确认旧计划,一边又挂新起(旧 Promise 悬空、弹框实例被顶替)。
   - **确认期草稿保护(2026-09-27 修订)**:执行段清空输入前经 `composerDraftRef` 活读全文,与 plan.content 相同才清;确认期间续写的新草稿保留。
   - **落定焦点归还(2026-09-27 修订)**:settle 时焦点不在 composer 内则回焦 `#composer-textarea`,防确认键卸载后焦点落 body 导致下次发送需重点输入框。
3. **门位与执行分离**:
   - `useComposerSend.sendCurrent`:校验(空文本/无 profile/无会话)后,若开关开 → 构建计划(单发/广播 + 显示用目标快照 + 内容)交回调挂起,直接 return;确认 → `executeSend(plan)` **重新现读** promptGate 再写(闸语义 = writeSession 前现读,确认期间 ask 态可能变化;广播目标也在执行时重解析)。
   - `useComposerDrawer.sendFromDrawer`(⚡):同门;确认后执行原管线,返回 wire 供抽屉 toast。
   - `/commit` git 预填联动移入执行段:取消确认不触发预填。
4. **键位实现纪律**:Enter 确认走 window keydown(延一宏任务挂载,见 2 修订);与输入法无交集(确认框无输入框),keyCode 229 兜底保留。
5. **目标卡结构化(2026-09-27 修订,大仙:看不出是哪块幕布)**:plan 持 `SendTarget[]`(位序徽标/标题/工作区/引擎/当前标记),不再拼单串。位序 = MainPanel 平铺 kept 序(1 起,公式唯一源 `broadcastTargets.keptSessionIds`);标题与 SessionTabBar resolveTitle 同源(手动命名 > 打开快照 > meta 标题 > 短码);工作区 = 归属匹配(workspaceId/root)展示名,失败回落 cwd 末段;引擎 = profile 展示名。广播 = 计数头 + 逐卡并列 + 当前幕布 chip。

## 验证

- `pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`。
- settings 契约测试:新键默认 true、非法回落;settingsDefaults.test 断言同步。
- 门行为测试(新增,覆盖消费可见bug):开关开时 sendCurrent 不写幕布、回调带计划挂起;关时直接写。计划构建(标题回落工作区名、广播目标行)。
- 桩目检:Enter 弹框显示目标+内容 → Enter 真写、Esc 取消草稿保留;抽屉 ⚡ 同;开关关掉后直发。
- `pnpm tauri:dev` 真窗口目检交互(大仙)。
