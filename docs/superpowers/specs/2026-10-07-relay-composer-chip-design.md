# 接力摘要芯片化 —— 不直写 PTY,挂 composer 芯片

- 日期:2026-10-07
- 状态:已确认(待落地)

## 背景与目标

W1 接力(session-relay)现状:`RelayDialog`(预览/编辑摘要)→ `createSession`(目标引擎新会话)→ `host.writeSession` 直写 PTY(bracketedPaste + CR 自动首发),staged 标注由 relay 侧手工序列化(`appendCarriedMarks`)附尾、写成功后翻 sent。

问题:首发即自动发出,用户在弹层里「可预览可编辑」之外没有最后一眼确认的机会;摘要(最长 6K+ 字)从未出现在任何可回看的输入面里。目标:接力内容不直写 PTY,改挂到新会话的 composer,以**结构化芯片**展示(同 marks「标记引用」芯片先例),用户检查(可再编辑)后随回车一起发出。

## 方案

数据流:`RelayDialog` → `createSession` → `setPendingRelay(sessionId, {text, truncated, source})` → 关弹层;新会话 composer 顶部长出接力芯片(`接力摘要 · N 字`,✕ 丢弃,点击重开弹层编辑态改「更新摘要/丢弃」);发送时 `registerComposerSendTransform` 把摘要**前置**拼装(payload = 摘要 + 空行 + 用户输入,用户输入可空),芯片消费消失;写失败经 `registerComposerSendUndo` 恢复芯片。

挂点全部复用现成契约(marks 同款先例):`ctx.contribute("composer.attachments")` 芯片条、`registerComposerSendTransform/Undo`、staged 标注回归 marks 自有管线(同 cwd 的 staged 芯片本就展示在 composer,随发由 marks transform 自然完成;`✕` 退回 pending 即可控制携带与否)。

唯一新增 kernel 契约:`composerExt` 增加 `registerComposerEmptySendProvider((sessionId) => boolean)` + `composerEmptySendPermitted(sessionId)`;`useComposerSend` 空文本守卫放宽为「空文本且无 provider 放行才拦」。接力首发常为纯摘要零输入,必须放行;marks 不注册、行为零变化。属宿主机制级契约(与 `registerComposerPendingCount` 同族,composerExt 即该契约模块)。

净删除:`writeSession` 直写路径、`appendCarriedMarks`/`CarryMark`、carrySet 勾选 UI、`emitPromptSent`/`setMarkState` relay 特判、「写失败留框重试」语义(失败面收窄为 createSession 失败)。

## 方案取舍

| 决策点 | 选定 | 被否决 | 理由 |
|---|---|---|---|
| composer 展示形态 | 接力芯片(折叠卡:N 字 + 引擎/标题) | 纯文本预填(composerReplaceRef 塞全文) | 6K 字摘要糊满 textarea 不可用;芯片与 marks 先例同构 |
| 空输入首发 | kernel 空 provider 放行 | 复用 composerPendingCount 放宽 | pendingCount 放宽会连带改变 marks「空输入不发」既有语义,静默扩权 |
| staged 标注携带 | 回归 marks 自有 transform | relay 手工序列化(appendCarriedMarks) | 同 cwd staged 本就在 composer 展示,双管线是历史直写的产物;顺带消「relay 侧另造格式」同步负担 |
| 空输入时 promptSent 文本 | 空串(tab 标题交给目标 CLI 自起) | emit 摘要原文(现状) | 与 marks carried「emit 只发用户原文」语义对齐;锚点存证靠 ts+ranges 不受影响 |
| 芯片点击交互 | 重开 RelayDialog 编辑态(更新摘要/丢弃) | 内联只读展开 | 复用全部现有编辑 UI;只读展开改不了内容,要改只能丢弃重来 |

## 验证

- 单测(TDD):composerExt 空 provider 注册/注销/查询;relayStore pending 置/弃/订阅/LRU;relayCarry transform 前置拼装/消费/undo 恢复/闸关不注入(经 useComposerSend 既有口径)。
- 门禁:typecheck / vitest 全量 / check:arch-boundary / check:file-size / build / react-doctor 100。
- 浏览器桩目检:tab 右键开接力 → 选引擎 → 芯片出现在 composer → 空输入可发 → payload 含摘要前置;✕ 丢弃即消失;点击重开编辑态可更新。
