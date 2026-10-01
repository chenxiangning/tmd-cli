# 工作区全量死代码评审与清理(两轮打磨叠加,约 6500 行 diff)

- 日期:2026-10-01
- 状态:已完成(发现项全部处置;门禁全绿;未提交)
- 范围:工作区全部未提交改动(226 改 + 35 新源文件),四路只读审查(kernel/壳层/styles、手机端、hub 域插件、工具类插件),每条 grep 全仓实证

## 结论先行

整体收口质量高:35 个新增源文件零孤儿(全部被引用);点名的 40+ 组嫌疑导出全部实证为活;CSS 增删两侧同步干净;词典迁移零残留。**实质问题 2 个**(1 个 diff 引入的功能回归 + 1 个史前死类),弱项若干,全部当场处置完毕。

## 发现与处置

| # | 位置 | 内容 | 判定 | 处置 |
|---|---|---|---|---|
| 1 | daily-journal/YearView.tsx:17 | 热力档类名丢 `dj-yc-` 前缀(d4 下沉 heatOf 时引入)——年视图热力着色整体失效,css 5 条选择器随之全死 | **确认死 + 功能回归** | 已修:`dj-yc-${heat}` |
| 2 | daily-journal.css `.dj-panel-day`(:135-136 及 :148 focus-visible 引用) | 史前孤儿(89d82107 起 tsx 零消费),本轮键盘可达规则二次引用 | 确认死 | 已删(两规则 + 选择器摘除) |
| 3 | kernel/locales/{en,ja}/mobile.ts:43 键「输入消息,回车发送…」 | placeholder 改版后旧键未删,全仓零消费 | 确认死键 | 已删 |
| 4 | mobile/useDraft.ts readDraft/writeDraft/draftKey | 仅模块内消费,export 冗余 | 弱 | 已去 export |
| 5 | session-search/indexer.ts tokenizeQuery | 同上,无外部/测试引用 | 弱 | 已去 export |
| 6 | mobile/SheetBase.tsx:15 注释 | 称「基类 .sheet 恒在」,实现是整体替换 | 注释漂移 | 已对齐 |
| 7 | kernel/terminalRefreshButton.tsx:7、plugin.ts:96 注释 | 「结构化幕布」措辞漂移(现名「结构化视图」) | 注释漂移 | 已改 |
| 8 | notify/index.tsx 额度预警通知 | 未传 onClick,深链支持面不一致(ask/turnEnd 有) | 一致性小瑕 | 已补 `host.setActiveSession` |
| 9 | 焦点陷阱 useFocusTrap 五副本(wizard/SendConfirmDialog/RelayDialog/SearchOverlay/git dialogA11y) | 近乎逐字重复 | 结构收口 | 已沉 kernel/useFocusTrap.ts(含 initialFocus 选项保 SendConfirm 编程聚焦变体),五处替换、dialogA11y.ts 删除 |
| 10 | kernel/ipc.ts armNotifyClickDispatch focus 监听器无 teardown | 应用级单例 | 保留(可接受) | 不动 |

判「保留」的代表性核实:BoardScan/RelaySummary 导出接口(导出函数公开返回类型,风格保留);liveOverlay 内部熔断 terminal 分支(qoder/omp/pi 瞬态探错仍可达);notify onAction 深链通道(桌面重聚焦边沿可达);marks 非 lost 快路径(有语义)。各插件 diff 新增 71+ 词典键逐键 t() 验证零死键;wallpaper lite / mcp-hub 旧键 / openPanel 契约 / ExitSessionToast 词典迁移均零残留。

## 验证

vitest 全量 445 文件 / 3460 测试全绿;typecheck 过;file-size 过;arch-boundary 过(kernel 新 hook 仅 import react,R1 无虞);check:i18n-keys 退出码 0;react-doctor 100/100。
