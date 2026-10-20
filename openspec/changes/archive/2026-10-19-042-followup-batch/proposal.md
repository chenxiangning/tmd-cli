# 提案:0.4.0 追加批(连续性六项:重启恢复 / 记忆文件面板 / 变更总览 / 草稿安全网 / 通知会话静音 / 转录批量导出)

日期:2026-10-19 · 状态:已拍板待实施(大仙 2026-10-19 对追加批示例组裁示:#9 深度设计 #10 UI 设计 #11/12/13 深度优化 UI 与逻辑闭环 #6 编辑器查找替换撤(已存在,替补批量导出);全部计入 0.4.0,分五批实施,每批 review 防跑偏,全绿后再提交)

## 背景与目标

042 混合批五项已全量落地(openspec/changes/2026-10-18-042-mixed-batch,39/40,余真机验收债)。大仙拍板追加批六项继续计入 0.4.0:每项补一条「断点」——跨重启(9)/跨引擎(10)/跨批次(11)/跨崩溃(12)/跨打扰(13)/跨带走(14)。设计来源:`docs/design/042-candidates/` 页 9-14(实现级锚点,产制时经六路深扫逐行核实)与 `docs/brainstorm/2026-10-19-042-followup.md`(二轮深扫修正记录)。

## 方案取舍(设计页定稿要点,实现不得偏离)

- **项9 重启现场恢复(M)**:持久三段身份(sessionOverlayKey 形态)非 tmd PTY id(sessionTabs.ts 头注「不持久化」被正面推翻);恢复走 `host.openDiskSession` 既有通道(自带 prefetchDiskTail 磁盘先行回放),不指望冻结快照命中(terminalFreeze.ts 头注明示侧栏重开存档天然不命中);启动插 DesktopApp ready 后 45s 错峰(hygieneBootSweep 先例),串行逐条、失败矩阵五路径(保留律清掉/工作区删→evict;引擎缺/spawn 败→保留 key;在途→聚焦);settings 新字段 `sessionRestore: {enabled, keys[]}` 三源 + 帽 sessionTabsMax;tile 平铺零新逻辑。否:恢复期间新线程/新会话模型、并行 resume(重操作压启动)。
- **项10 记忆文件面板(S-M)**:路径**声明式**(profile 增声明字段,骨架照 skillSources.ts 缺失隐藏不猜测;仓库现状零路径知识,只有 academy 文案与 codex sessionHead 包装识别)——否硬编码路径表(版本漂移+内核纪律);右栏并列注册新面板 memory-files(一插件一面板无先例但注册表支持,需同步 settingsIconDecor 三表+词条);行三态=在/未生成/未声明;编辑=openFileInTab 任意绝对路径(anim 先例),零代写零 AI。否:内容预览折叠(行长悬殊)、跨文件 diff(二期)。
- **项11 会话变更总览(S-M 纯前端)**:CheckpointsPanel 第三视图(一个文件改动面:view union+segCls+hidden 保活容器+新 ChangesPanel.tsx 吃 state.batches);batches.flatMap 线性建组(≤100 批无需索引);**状态合成优先级表**(最近批字段:changed→内容已变/reverted→已回退/committed→已提交/same→改动中(canRevert 判据)/status=D→已删除/no_baseline→chip)写死防漂移;± 口径=TurnFile.additions/deletions 账本累计(回退不回缩,与 BatchSheet diff 缓存口径双注明);行点击 openBatchTab focusPath 深链(evidenceScope 先例)。否:后端聚合命令(字段已全,纯前端折叠)、按文件反查索引(量级不需要)。
- **项12 草稿安全网(S-M + 小块 Rust)**:双腿——①关窗闸:onCloseRequested(kernel/ipc.ts 唯一 import 点,onResized 订阅先例)→ preventDefault → 聚合确认(getTabs().filter(dirty),dirty 写点全仓恰三处)→ 逐 tab 强制放行 → windowClose;⌘Q 应用退出腿=Rust app_setup 补 ExitRequested prevent + 事件桥 + 强制退出命令(bypass 标志);web 态 isWeb 短路。②草稿镜像:files 内存 Map/journal 组件态/ssh-file 无缓存三处 → localStorage 防抖镜像(键 tmd.fileDraft.* / tmd.journalNoteDraft.*,TTL 7 天台账 mobile 先例,256KB 截断,try/catch 静默)+ 恢复黄条;composer/ss 已持久不动。否:串行逐个问(退出场景聚合一次问清)、草稿进 settings(取舍先例=草稿永远裸 localStorage)。
- **项13 通知会话静音(S-M)**:存储复刻 sessionPins 全套六处(settingsSessionEntries Entry/settingsTypes sessionMutes/kernel sessionMutes.ts/MERGE_TS_FIELDS mutedAt/sanitizeSessionMutes/帽 2000);key=三段身份(cliSessionId 跨 resume 存活;claude fork 漂移=已知边界 [INFERENCE] 注释);**三档语义**:静音通知(turnEnd/exit/quota 静,ask 穿透=安全默认)/完全静音(含 ask,三重可见性兜底)/snooze 至回合结束(turnSettled 自清,exit 放行防 entry 永挂);闸插点=shouldNotify 加 sessionId 参数,quota 腿拦 fireQuota 的 record 之后 send 之前(**绝不写 quotaSeen**——跨周期永久抑制);入口=两套右键菜单 JSX 内联+通知中心行钮+设置概览卡。否:全局总闸(与免打扰重复)、按裸 sessionId 键(resume 断链)。
- **项14 转录批量导出(S-M 零 Rust)**:抽 exportMdTo(dir) 单会话内核(viewerTab 现逻辑);入口三面=viewer 工具行(现状)/SessionManage 批量条「导出」(pickDirectory 现成四消费先例)/活会话右键快照(041 明示后补,导已落盘部分并注明时点);文件名 sessionExportFileName+防撞 -2;帽 50/批;失败矩阵=适配器缺失 skip 入失败列表(不猜纪律)/磁盘满中止留存/可取消。否:zip 打包(下游直吃 md,二期再说)、批量 pickSavePath(N 个弹窗反人类)。

## 验证(计划)

- 每批 targeted vitest;批间 review(重点:任务是否跑偏、是否闭环——失败路径/生命周期清理/兼容性逐项对表)。
- 收口:`pnpm check:gate` 全链绿;Rust 项(12)`cargo test && cargo clippy --all-targets -- -D warnings && cargo fmt --check`;`npx react-doctor@latest -y`=100;动过 t() 处核对 i18n 三段;1421 桩目检各主流程+边界态。
- 兼容性红线:settings 新字段缺省回落(sanitize 单测覆盖);旧 localStorage 无键不报错;菜单/面板对未落盘会话与缺声明引擎的降级显式。
- 全部批次 review 通过后分项独立提交(中文祈使句),推送前最新树再跑 gate。

## 任务

见 tasks.md(批次序:13+14 → 12 → 11 → 10 → 9 → 集成收口)。
