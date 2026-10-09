# 2026-10-09 24h 变更综合评审(13 commits,02dc8dba^..f4a50e27)

日期:2026-10-09
状态:已收口(评审发现全部裁决,P1/P2 已修,P3 记录不修)

## 背景与目标

近 24h 落地 13 个 commit(67 文件,+3686/−317):git 批量拉推聚合模式(47b1033d、4c28d56f、54769b02、12ef1f01、f4a50e27)、编辑器行号槽 diff 着色(ab1dbddb、f8c342e9)、useMinSpin 刷新反馈原语(5928a882)、checkpoints/各插件散点打磨(bb598644 等)、0.3.3 发版(eb5a6c05)。本次评审从系统兼容、性能、死代码、架构规范、边界五个维度全面体检,并当场实施修复。

方法:分三片并行——A(git 批量核心,主审亲读)+ B(编辑器 diff 着色,reviewer)+ C(散点 UI,reviewer);B/C 逐文件通读现态全文 + 横向核对消费方/词典/CSS,所有发现基于实证,禁凭 diff 猜测。

## 发现与裁决

### P1(真 bug,已修)

| # | 位置 | 问题 | 修复 |
|---|---|---|---|
| 1 | kernel/useMinSpin.ts | 迟落定的旧 spin `clearTimeout` 杀掉新点击的停表 timer,自身批次号守卫又 no-op → 忙态永久卡死(慢 A + 快 B + A 迟到即复现) | 计时核抽 `createMinSpinCore`,finish 头部加迟到落定守卫;4 条回归测试(含 P1 复现用例) |
| 2 | plugins/files/useFileLineDiff.ts | ws.root 未 normalize,Windows 反斜杠根使 `startsWith` 永假 → 行级着色在 win 上整体静默失效(macOS/Linux 测不出) | base 与 path 双侧过 `@kernel/pathUtils` normalizePath(先例:lsp 归属解析) |
| 3 | kernel/cmEditor/editorDiffGutter.ts | 替换行(mod)同时发 mod+del 两枚 marker,CM6 同槽块级兄弟节点纵向叠放,3px 红条越行错格 | del 让位:add/mod 已占行不发 del;尾删多锚夹回同行去重;测试期望同步更新 + 补夹回去重用例 |

### P2(已修)

| # | 位置 | 问题 | 修复 |
|---|---|---|---|
| 4 | plugins/git/useBatchGitOps.ts | 四个入口闸只读 `running` state,同 tick 双触发读到旧值会双跑整批 | `runningRef` 同步闸(ref 置位先于首个 await),三入口硬化 |
| 5 | plugins/files/useFileLineDiff.ts | `full=true` 使 patch 文本 ≈ 整文件全文,每次打开/保存全量过 IPC;gutter 只需 hunk 头行号与 ± 行 | 改 `full=false`,标记集逐位等价(diff.rs 语义已核),传输/解析降为 O(变更) |
| 6 | files/editor/useFileDocument.ts + useFileLineDiff.ts | 磁盘外变重读正文后 diff effect 依赖无一变化,旧 patch 标记挂错色 | useFileDocument 暴露 `diskTick`,重读自增,并入拉取依赖 |
| 7 | plugins/git/views/AggregateReposView.tsx | 299/300 行贴线,后续改动必破铁则 | 拆 `AggregateRowParts.tsx`(RowStatus/RowQuickOps),299→256 行 |
| 8 | kernel/useMinSpin.ts 文件头 | 「忙态期间重复点击不重启计时」与实现相悖(纯反馈不拦截、忙期内再点顺延窗)——12+ 消费方的契约注释撒谎比没注释危险 | 注释改为如实契约(不吞事件、防重提交由调用方 disabled) |
| 9 | plugins/git/views/AggregateReposView.tsx | 截断 title「请在 RepoBar 逐仓操作」过时(RepoBar 已是选择器) | 改「仓库选择器」;en/ja 词条同步换 key |

### P3(记录不修)

- git_ahead_behind 聚合扫描无界并发(N 个并行 IPC):Rust 侧 spawn_blocking + in-process libgit2,几十仓毫秒级;仓数上百再批量化。
- 聚合态下主面板数据钩子(5s status)仍挂父层:单仓量级,切回本仓数据即时,记录。
- splitUpstream("origin/") 空分支形态:git 不会产出,不防御。
- useMinSpin 卸载后 ≤600ms 计时器:React 18+ 卸载 setState 为 no-op,泄漏面一个计时器,不加 alive 状态。
- checkpoints/BatchRowParts 三枚同款 hover 按钮未提 const:同文件 2+1 处,跨插件收敛须上 kernel(2 消费方不值),记收敛候选。
- mcp-hub/InstallDraftModal 裸 setTimeout(1500) 自动关:同窗 ServerEditModal 有 useEffect+clearTimeout 更稳先例,后续对齐。
- fsRevealInFileManager 失败 checkpoints 静默吞 vs git 侧 console.warn:口径待统一,最低成本对齐 = warn。
- McpHubPanel 失败行共用一个 useMinSpin:点任意行全行同转,纯视觉噪音,拆件不值。
- 带草稿重开的文件保存前无基准标记:与「变脏期不重拉」策略自洽,待实际反馈。
- ws 根非仓根(嵌套仓)时 useFileLineDiff 每次多一发注定失败 IPC:降级无害;后续复用 owningWorkspaceRoot 思路。

## 各维度结论

- 系统兼容:win 反斜杠根 2 处(行级 diff、FileCodeEditorImpl 路径族)已修/已核;CRLF 链路(toEditorContent/toDiskContent)未见问题;wsl 远程工作区聚合扫描显式排除,与 GitPanel 降级同依据。
- 性能:批量执行有界并发(6)+ 取消语义正确;useAggregateRepos 不挂轮询符合取数纪律;useFileLineDiff 无 keystroke 级重算,gutter 单例装配无泄漏;P2-5/P2-6 修后打开/保存路径 O(变更)。
- 死代码:13 commit 内已清 repo-bar-divider CSS、孤儿 i18n 键(仓/工作区内发现的 Git 仓库数);本轮补扫 git/files/locale 全量孤儿键为零;editorDiffGutter 全部导出有生产消费方。
- 架构:R1/R3/R4 与 300 行铁则过检;useMinSpin(≥3 插件 + kernel 自用)kernel 收口成立;MenuShell 复用无环;DialogActions 三可选参默认值保持旧语义,11 处消费零破坏;i18n en/ja 全量成对。
- 边界:空态/错误态(HistoryView 三态、McpHubPanel role=alert、ScanErrorBar、BoardTab 首扫)齐全未破坏;patch 二进制/clean 文件/无仓三条路径正确清除;alive 竞态防护完整。

## 验证

typecheck、vitest 486 文件 / 3792 测试(含本轮新增 5 条回归)、check:file-size、check:arch-boundary、build、react-doctor 100/100 全绿;Rust 零改动。评审修复随后续 commit 收口。
