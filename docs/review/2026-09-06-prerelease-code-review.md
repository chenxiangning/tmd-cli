# 2026-09-06 发版前代码评审

日期:2026-09-06
状态:已落地(修复清单全部修完,验证全绿;缓修 4 项记入文末)

## 背景与目标

发版前最后一轮代码评审。评审基线:300 行铁律拆分刚收官(TS/TSX/CSS 全清零,
仅剩 kernel/ipc.ts 豁免),CI 四件套 + Rust 三件套全绿。本评审聚焦 CI 查不到的
语义层:死代码、硬编码、断言说谎、平台行为偏差、注释/文档与实现漂移。
共立案 16 项:死代码 3、P1 缺陷 2 族(4 处)、P2 低成本 7、缓修 4。

## 发现清单

### 已修 —— A. 死代码删除(3 处,grep 确认零引用后删除)

| 位置 | 处置 |
|---|---|
| kernel/sidebarActions.ts `getSidebarActions` | 删除;壳侧消费走 useSidebarActions hook,函数零引用 |
| memory-coordinator/install/detect.ts `HarnessKind` | 删除;类型零引用 |
| memory-coordinator/install/setup.ts `InstallPhase` + `InstallProgress` | 删除;InstallOrchestrator 不依赖(编排以 InstallStepResult + onLine 回调通信) |

### 已修 —— B. P1 缺陷

| 问题 | 方案 | 理由 |
|---|---|---|
| install/bootstrap.ts util chunk 硬编码哈希文件名 `index-147qn1yq.js`(dist 文件名随版本变化,硬编码必过期;旧代码 `.catch(() => null)` 静默降级 storageDir=null) | 与 core chunk 同款动态扫描:遍历 distDir 的 `index-*.js`,按导出面(`getMagicContextStorageDir`)定位;找不到输出 `REFUSED util-chunk-not-found` 显式失败;24-26 行自相矛盾的注释同步改写 | chunk 定位契约统一为「扫描导出面,不认文件名」;静默降级会让迁移写到错误库路径,比显式失败恶劣 |
| adopt 竞态守卫非空断言说谎(sessionSpawn.ts / shellSessions.ts / sshSessions.ts 三处同构拷贝:`return findSession(id)!`,守卫分支命中时实际返回 undefined,下游 `.id` 访问即 TypeError) | 三处合并为 kernel/sessionAdopt.ts 的 `adoptPtySession`(订阅/守卫/广播收口);守卫分支成对退订 + 广播 sessionStartFailed(StartFailureToast 路径,与 spawn 被拒同语义)+ 显式返回 null;调用方抛出 `ADOPT_RACE_REASON`(全部外部调用点本就有 rejection 处理);CLI 路径的秒退守望经 onExit 钩子保持「摘尾先于 removeSession」时序 | 消灭 TypeError 风险;三份同构拷贝是 09-05 评审定性的滞纳金;sessionSpawn 的 SessionSpawnHost 补 findSession 面(hostSessionServices 接线) |

### 已修 —— C. 低成本 P2

| 问题 | 方案 |
|---|---|
| shortcuts.ts:macOS 上 Ctrl+键被全局快捷键劫持(`(e.metaKey \|\| e.ctrlKey)` 认任一) | 平台严格分流:macOS 仅 metaKey、其他平台仅 ctrlKey(用 kernel/platform 的 getPlatformKind);unknown(浏览器 dev 探测失败)保持宽松兜底;keybinding 文档注释同步 |
| MemoryCapsule.tsx 注入提示硬编码「claude」 | 改用组件内已有的当前会话 profile 展示名(`profile?.name ?? "当前 CLI"`) |
| sqlite.rs 头注释写 READ_ONLY,实现实为 READ_WRITE + query_only(WAL 重放需要写句柄) | 头注释同步为真实描述(含「为什么不能用 READ_ONLY」的既有 inline 理由上提) |
| CommitComposer.tsx 提交成功仅 console.info | 走同文件 error 同款用户可见反馈通道:新增 note 状态(成功绿字 `已提交 <sha7>`),下一次编辑/提交即清;onCommitted 状态刷新保持 |
| pty_spawn.rs 泵循环结束 tail 残留不完整 UTF-8 序列被静默吞掉 | 新增 `flush_utf8_tail`:泵尾残留按 U+FFFD 替换补发一个输出事件(日志侧原始字节本已落盘,只缺解码事件) |
| formatBytes 两份实现(attachments.ts 带空格 "1.5 KB" / FileImagePreview.tsx 紧凑 "1.5MB") | 不合并(输出契约刻意不同),两处互加注释声明差异并互指 |
| openspec 悬空引用 2 条 | session-list-budget-plugin/proposal.md:`src/plugins/workspace/budgetCommit.ts`/`BudgetPopover.tsx` → `src/plugins/session-budget/` 真实路径(迁移注记同步改写为「已按现状修正」);git-right-panel/proposal.md:codemoss `src/features/git-history/` 补注本仓实现位于 `src/plugins/git/` |

### 缓修(记入文档,本轮不动代码)

| 项 | 缓修理由 |
|---|---|
| gitGraphRefs merge-base 改 Rust git2 真值 | 行为变更面大,需独立 spec 与数据集回归,发版窗口不引入 |
| sftp 传输表 TTL | 需先定传输完成/失败态的保留语义,属于功能设计不是缺陷修复 |
| settings memory* schema 出 kernel | kernel/settings 通用原语外迁涉及 settings 迁移路径,发版窗口不动数据面 |
| macOS Emacs 键深度方案 | 本轮已修「⌃ 键不被劫持」(shortcuts 平台分流),深度方案(⌃A/⌃E 等进 PTY 的逐键语义)留独立 spec |

## 验证

修复后全量复跑,全部通过:

- `pnpm typecheck` ✅ 无错误
- `pnpm test` ✅ 113 files / 879 passed(基线 110 / 866;+3 测试文件 +13 用例:
  sshSessions.test.ts 4、sessionSpawn.adopt.test.ts 3、bootstrap.test.ts 4、shortcuts 平台分流 2)
- `pnpm check:arch-boundary` ✅ R1/R3/R4 全过
- `FILE_SIZE_LIMIT=300 node scripts/check-file-size.mjs` ✅ 全绿(仅 kernel/ipc.ts 豁免;
  新增 sessionAdopt.ts 79 行、sshSessions.test.ts 等均未触线)
- `cargo test` ✅ 177 passed / 1 ignored(基线 175;+2 用例:flush_utf8_tail 两条)
- `cargo clippy --all-targets -- -D warnings` ✅ 无警告
- `cargo fmt --check` ✅ 无差异

未跑 `pnpm tauri:dev` 真窗口目检(本轮修复以纯逻辑/文案为主,UI 行为改动仅
CommitComposer 成功提示一处,呈现复用 error 同槽位家族)。
