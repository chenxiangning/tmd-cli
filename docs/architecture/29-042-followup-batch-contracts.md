# 29 - 0.4.0 追加批(连续性六项)落地契约

日期:2026-10-19 · 状态:已落地(openspec/changes/2026-10-19-042-followup-batch,五批实施每批 review;设计示例 docs/design/042-candidates/ 页 9-14;裁决与深扫修正 docs/brainstorm/2026-10-19-042-followup.md)

六项断点:跨重启(9)/跨引擎(10)/跨批次(11)/跨崩溃(12)/跨打扰(13)/跨带走(14)。本文只记跨批契约与裁决,细表见 CHANGELOG 0.4.0。

## 1. 重启现场恢复(kernel/sessionRestore.ts)

- **持久三段身份非 tmd id**:`sessionRestore = { enabled: boolean; keys: string[] }`(keys=`wsId:profileId:cliSessionId` sessionOverlayKey 同构,首=最旧,帽=现读 sessionTabsMax);settings 三源,sanitize 去重保序+帽尾弃+enabled 回落 true。sessionTabs 头注「不持久化」已改写;trackOpen 落键(身份不全不记,重复聚焦幂等零写)。
- **回位通道**:boot ready 后 45s 错峰(hygieneBootSweep 同值常量,改须同改),串行逐 key `host.openDiskSession`(远程工作区 `openRemoteDiskSession` 同族;远程跳过本机扫盘预判——`profile.listSessions` 只扫本机,远程误 evict 修复);恢复走磁盘回放,冻结快照不命中是设计内(terminalFreeze 头注)。
- **失败矩阵**:畸形 key/工作区删/磁盘缺失(本地 listSessions 记忆化预判)=evict;引擎缺/spawn 败/扫描失败=保留 key;在途=活表去重聚焦。pill「正在恢复上次会话 N/M」可跳过,终了现读 settings 回写 evict(不吃循环快照)。
- 已知边界:claude fork 漂 key 落空=spawn 败保留兜底 [INFERENCE];归档会话照常 resume。

## 2. 跨引擎记忆文件面板(memory-coordinator)

- **声明式**:`CliProfile.memoryFiles?: { scope: "project"|"user"; label; relPath }[]`——内核零路径知识;claude 双路径/codex 双路径/kimi·qoder(工厂双变体同享)·qoder-cn·opencode·pi 项目 AGENTS.md;omp/dsh/grok 零声明=未声明灰组「—」。探测=`fsReadHeads(paths,1)` 批量(空串=缺失/0 字节/读失败不可分辨,已知边界);行三态在/未生成(「/init 可生成」)/未声明;打开=`openFileInTab` 任意绝对路径;零代写零 AI。面板 id `memory-files`(order 32,ecosystem),图标三表+settingsIconDecor 白名单/DEFAULT/iconDecorItems+CSS 消费行六处闭环(icon-decor 键 81)。

## 3. 会话变更总览(checkpoints 第三视图)

- view union `batch|changes|timeline` 三档 hidden 保活;`changesData.ts` 纯折叠(batches.flatMap,≤100 批零索引)。
- **状态合成优先级(写死)**:最近批文件条目上 reverted→已回退 ⇒ status=D→已删除 ⇒ live=changed→内容已变 ⇒ committed→已提交 ⇒ same→改动中(canRevert 判据与 BatchSheet 同源三处逐字,改须同改);no_baseline 只出 chip 不改主态。
- **± 口径**:BatchFile 新增 additions/deletions u32 **序列化透传**(sealed 取 TurnFile 真值,open 轮记 0;零新命令零聚合,2026-10-19 拍板),总览=账本累计「回退不回缩」,与审阅单 diff 缓存口径双注明。行点击 `openBatchTab focusPath` 深链;cap 50;摘要条=全会话口径不随过滤变。

## 4. 草稿安全网(kernel/draftMirror.ts+quitGuard.tsx)

- **草稿镜像**:slot `file:<path>`/`journal-note:<ymd>`/`ssh-file:<path>`,localStorage `tmd.draftMirror.<slot>`+`_ledger` 台账;300ms 防抖写穿、256KB 截断(truncated 跨重启存活)、TTL 7 天(get 惰性清+写路径 GC)、全程 try/catch 静默;恢复条三面共用 `draftMirrorBar.tsx`(内存草稿在场/镜像==磁盘文本不弹);save 成功/单 tab 闸丢弃/恢复丢弃三处清;**退出强关不清镜像**(崩溃网,重开走恢复条)。composer/ss 已持久草稿不接。
- **关窗闸(单腿)**:`onCloseRequested`(ipc.ts 原语,isWeb no-op)→ 有 dirty(`getTabs().filter`)→ 聚合弹层(「放弃并退出」danger/「取消」默认聚焦/「本次不再问」=**本次运行内存标志**,非持久)→ `requestCloseAllTabs({quit:true})`:绕 beforeClose 强关+`cancelAllAsks` 按不放行结清+`Promise.allSettled` 结算等待→`windowClose()`。无 dirty 直接放行;⌘W/右键单关与各 kind 闸零变化。
- **⌘Q 腿裁决取消**:tauri-runtime-wry 2.12.1 `ExitRequested{code:None}` 仅来自最后窗 Destroyed,prevent=无窗僵尸进程;tao 0.37 macOS 无 applicationShouldTerminate,⌘Q 不发 ExitRequested——Rust 腿已整体拆除(lib.rs 与 HEAD 逐字节一致),⌘Q 需菜单装配另立条目。close 腿与镜像即本项交付面。

## 5. 通知会话级静音(kernel/sessionMutes.ts+notify)

- Entry `{mutedAt, mode: "mute"|"full"|"snooze", askRing?}`;三档判定 `mutedKinds`:mute=turnEnd/exit/quota 静 ask 穿透;full=全静(askRing=true 放 ask);snooze=turnEnd/quota 静,ask 与 exit 穿透(防 entry 等不到自清)。key=三段身份(未落盘会话不静音,菜单隐藏);settings 六处接线同 sessionPins 族(MERGE_TS_FIELDS mutedAt+sanitize 帽 2000)。
- **闸插点**:notify dispatch/exit/quota/失焦补扫四路径 record 之后 send 之前(派发侧闸,shouldNotify 签名不动);**quota 绝不写 quotaSeen**(import 图零交集结构保证);askSound/turnSound 同 mutedKinds 闸(turnSound 结算刻捕获静音态——依赖 bootTurnSound 先于插件激活的 boot 序,已注释);snooze 自清挂 turnSettled 订阅全会话。入口:SessionContextMenu/TabContextMenu/通知中心行钮/设置概览卡。
- 已知边界:claude fork 漂 key [INFERENCE];声音闸依赖 boot 顺序(隐式耦合已文档化)。

## 6. 转录批量导出与活会话快照(session-viewer/workspace)

- 内核 `exportMd.ts`:`exportMdTo(dir,target,taken?)`(定位→readSessionTranscript→blocksToMarkdown→dedupeExportName -2 递增+盘上占用让位→writeText 原子写)与 `snapshotMdTo(path,target)`;全程不抛,失败归一 no-adapter/unreadable/write-failed。
- 批量:SessionManage 批量条→pickDirectory(取消静默)→串行(no-adapter/unreadable 跳过续跑,**write-failed 中止已写留存**,汇总「已写 N · 中止于 X」);帽 50 **拒开跑**提示分批;进度 toast 可取消。
- 快照:SessionContextMenu「导出转录快照」仅磁盘绑定会话(cliSessionId 判空,ssh/shell 隐藏),导当前磁盘快照+时点注明;viewer 单会话原交互零变化(改调 snapshotMdTo 同内核)。

## 横切纪律

- settings 覆盖层族新增两员(sessionMutes/sessionRestore)与既有 sessionPins/sessionArchive/sessionTitles 同构;sanitize 装配相邻无交叉;双实例合并字段 mutedAt。
- i18n 全部三语;菜单 props 全部 optional 向后兼容;插件↔kernel 依赖方向零违反;@tauri-apps 仍只在 ipc.ts。
- 真机目检清单(留大仙):重启恢复全流程(含 1 个 WSL/SSH 会话)/红 X 关窗两态进程必须退出/⌘W 单关回归/静音三档矩阵抽查/批量导出真机一炉+失败列表掺无适配器/记忆文件面板三态。
