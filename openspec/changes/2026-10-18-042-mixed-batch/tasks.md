# 任务:0.4.0 批次混合批实施清单

实现口径唯一来源:`docs/design/042-candidates/feasibility.md`(推演定稿,含契约/边界矩阵/裁决/验证/步序)。批次顺序 = 项1 → 项4 → 项7 → 项3 → 项6(成本升序,先低风险后 Rust 面),每项独立提交一笔,批间跑 targeted vitest;集成收口单独收尾。

## 批次一:项1 路径点击(S,纯 TS)

- [ ] `src/plugins/files/terminalPathLinks.ts`(新):PATH_RE(相对/绝对/:line/:line:col/盘符/UNC,排 `://`,含空格路径须分隔符)+ `filePathLinkProvider`
- [ ] `src/plugins/files/index.tsx`:activate 注册 + 退订
- [ ] `terminalPathLinks.test.ts`:正则矩阵 + root 拼接 + 区外静默
- [ ] 文件头注释钉 cwd 漂移天花板

## 批次二:项4 历史修复+抽屉(S-M,纯 TS)

- [ ] `src/kernel/promptHistory.ts`:去 slice 截断(存全文)+ MAX_BYTES 512KB save 期淘汰
- [ ] `src/plugins/composer/view/usePromptHistory.ts`:suffix 展示截断 ≤300,accept 全文
- [ ] `src/plugins/composer/view/HistoryDrawer.tsx`(新):子串过滤+高亮+键盘契约+空态
- [ ] `Composer.tsx` 挂载 + Cmd+L 局部 state(超行限则 state/historyOpen.ts 单例)
- [ ] `composer/index.ts`:composer.toggleHistory 命令(promptHistoryEnabled 同闸)
- [ ] promptHistory.test.ts + composerTextareaKeys.test.ts 扩用例

## 批次三:项7 额度告警增量(S,Rust 零改动)

- [ ] `vendors/types.ts` balanceValue 旁挂 + deepseek/relay adapter 透传
- [ ] `quotaWindow.ts` 迁 `cli-shared/quota/`(welcome 改 import,纯 cutover)
- [ ] `quotaWatch.ts` 补余额腿(绝对阈值)+ claude 窗口腿(尾读推算)
- [ ] notify poll 接线 + quota 分支改走 shouldNotify 三闸(NotifyKind "quota")
- [ ] `log.ts` notify-log 头部 quotaSeen 持久化 + 随 notifyLogDays 裁剪
- [ ] NotifySettingsTab 两键(notifyQuotaBalanceBelow / notifyQuotaResetMinutes)+ locales 三语
- [ ] 单测:阈值/去重/窗口纯函数 + minimax 口径断言 + 三闸矩阵

## 批次四:项3 跨工作区检索(M,纯 TS)

- [ ] `indexer.ts` 拆 `searchCore.ts`(searchSessions/applyFilters/snippetOf/时间谓词)
- [ ] cache 值加 cwd + prime 命名空间剪枝 + 全局 LRU 3000
- [ ] SessionIndexer 收 cwds[] + per-entry workspaceId + workspacesTotal/scannedWorkspaces
- [ ] `indexerTicks.ts` 时间盒排空(12ms)
- [ ] `SearchOverlay.tsx`:scope chip + 进度行 + openHit 先 setActiveWorkspace 后跳 + 失效区灰 pill
- [ ] 单测:剪枝/LRU 淘汰序/locateTargetOf/失效区数据/时间盒上限

## 批次五:项6 恢复预览(M,Rust)

- [ ] `restore.rs` 抽 `plan_restore(cwd,batch_id,paths)->RestorePlan`(restore_batch 改消费)
- [ ] `commands.rs` + `lib.rs` + `ipc.ts` 三处登记 `checkpoint_restore_preview`
- [ ] ConfirmCard 升级预览表(RestorePreview 契约/fileChipCls/覆盖本地药丸/截断展开/失败回落文案)
- [ ] E_Empty 免弹分支(中性提示)
- [ ] undo_revert 复用 revert 预览
- [ ] Rust 单测(plan 交集/空集/skip/binary)+ 桩目检

## 随手带(随对应批次顺车)

- [ ] 搜索浮层 Aa/.\* toggle + n/m 计数(terminalSearch.tsx)
- [ ] 检索多命中计数+展开子命中(session-search 展示层)
- [ ] ⌘+/⌘-/⌘0 字号缩放(写回 settings.terminalFontSize)
- [ ] anim Windows `explorer /select` reveal(IS_MAC 闸分流)

## 债收尾批

- [ ] workbench 空壳批量归档工具(照 `docs/superpowers/specs/2026-10-17-workbench-shell-archive-design.md`)
- [ ] 真机验收债陪跑(M2 余 6 项/0.3.5×14/0.3.7×6/anim 真窗口/M9 失败 pill,随大仙节奏逐项登记)

## 集成收口

- [ ] `pnpm check:gate` 全链绿 + `npx react-doctor -y` 100 + Rust 三链绿
- [ ] 版本六源核对(已收口在 0.4.0,本批无需再 bump;package.json/Cargo.toml/Cargo.lock/tauri.conf.json/mobile project.yml/Info.plist)
- [ ] CHANGELOG `[0.4.0]` 小节增录本批条目(发版前唯一事实源)
- [ ] 架构契约沉淀 `docs/architecture/28-`(若形成跨插件契约)
- [ ] 1421 桩目检五项主流程 + 边界态
