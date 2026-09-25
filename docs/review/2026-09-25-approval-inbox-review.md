# 审批收件箱换角度评审(功能完整性 / 架构边界 / 系统兼容)

> 日期:2026-09-25 · 状态:已完成(8 发现全部当场修复,随本批提交)
> 被审:commit 4651c65(approval-inbox 落地批);方法:双路 reviewer 切片(功能完整性 / 架构+边界+兼容)独立评审,主会话逐条对源码核实后修。

## 发现与处置

| # | 严重度 | 发现 | 证据 | 处置 |
|---|---|---|---|---|
| 1 | P1(双路同指) | 非收件箱路径作答/静默自愈后行滞留:终端直接答 y、手机桥写、自愈摘签都只 `host.notify`,不发 kernel topic,store 四事件订不全,幽灵行滞留到 turnSettled(可达数分钟),期间输入框可向运行中会话误写字节 | store.ts 旧 120-125;host.writeSession 作答仅同步清位 + notify | boot 改挂 `host.subscribe(refreshInbox)`(host.notify 全量旁路;refreshInbox 同值短路,代价可忽略),撤 turnSettled/sessionsChanged/sessionExited 三条冗余订阅;补幽灵行回归测试 |
| 2 | P2 | 后见补盲假造时长:observeCurrentWaitings 无条件记 `since=Date.now()`,等 2 小时显示「等待 3 秒」,违反提案自己的「面板后见显示等待中」取舍 | store.ts 旧 106-113;formatWait 的 null 分支形同虚设 | observe 路径不再记 since,留 null 显示「等待中」;测试钉住 |
| 3 | P2(主会话自查,评审未报) | CJK 输入法组词回车误发:Enter 发送未查 `isComposing`,中文确认组词的回车会把半成品应答写进 PTY | panel.tsx 旧 onKeyDown | `!e.nativeEvent.isComposing` 闸 |
| 4 | P3 | send 无在途闸,快速双回车重复写 PTY(第二发可能误答 CLI 下一问) | panel.tsx 旧 send() | sending 态在途闸:输入框与按钮禁用 + 早退 |
| 5 | P3 | 死会话作答反馈不可达:writeSession 调用即同步清 ask 位 → 行先消退,行内 failed 横幅永远渲染不出来,草稿无声丢失 | store 旧 finally(refreshInbox) 与 panel 行内 failed 的时序矛盾 | 失败反馈上移 store(failure 提示位)+ 面板级横幅(点击关闭);成功作答清位;补测试 |
| 6 | P3 | 读屏缺口:input 仅 placeholder 无 aria-label;摘要行无 role="status",新等待上行零播报 | panel.tsx 旧 53/107 | input 补 aria-label;摘要行 role="status";摘录 pre 补 title(悬停看全文)+aria-label |
| 7 | P3 | 提案风险表「摘录过期」对策只落一半:「以会话面板为准」文案只在代码注释里,UI 无处可见 | store.ts 旧注释 vs panel | 摘要行文案补「摘录以会话面板为准」(en/ja 同步) |
| 8 | P3 | i18n:meta.name「审批收件箱」未进 en/ja 词典,插件市场卡显示中文;另测试补盲与复 ask 重拉零覆盖 | PluginMarketList 消费 t(meta.name);store.test 无 observe 用例 | 两词典补 name;补 observe 补盲 + 复 ask 重拉新摘录两测试 |

## 已核对无发现的方向

- **架构**:R1/R3/R4 静态与脚本双过(check:arch-boundary 实跑绿);注册全走 ctx.registerFilePanel/ctx.events 无绕行;kernel 零改动(无 approval-inbox 知识);300 行铁则过;locales 无死键无漏译。
- **边界**:消费面全为 kernel 公开导出(isWaitingConfirm/writeSession/getSessions/getCliProfile/ipc.sessionLogSize/sessionHistoryPage/stripAnsi 公开再导出);无磁盘私有格式解析;store/组件分离干净(react-doctor 100)。
- **系统兼容**:ANSI_RE 覆盖 OSC BEL/ST + CSI + 8-bit,CRLF 兼容;SSH/shell 会话 askWatch 侧豁免,store 天然排除;webview 重载经 bootAskRestore 重播种 + observeCurrentWaitings 补盲自洽;interval 有 cleanup 无泄漏;窄栏 min-w-0/truncate/flex-none 配齐。
- **功能面**:提案承诺能力全落地,风险表三条对策在码(本轮补齐第 2 条的 UI 文案)。
