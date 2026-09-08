# 2026-09-08 午后提交全量代码审核

- 日期:2026-09-08
- 状态:已完成(报告;H1/H2/P1 已随 7bd17cc / bc6349e / 2e0bf67 修复)
- 范围:`83dbfd5..7389929` 共 15 笔提交,111 文件 +4283/-733
- 方法:6 个主题 reviewer 并行深审(PTY 幕布 / 会话扁平化 / 自动激活链 / 时间线 / git diff / iconDecor),主会话亲核全部「高」级发现并跑完整验证链

## 结论

**PTY 幕布主题 2 笔「高」级问题建议尽快修复**,其中遮罩卡死影响终端可用性;其余 20 条均为 P2(注释失真、测试缺口、小冗余、微性能)。机械验证链全绿:typecheck / JS 1116 测试 / Rust 183 测试 / clippy -D warnings / fmt / arch-boundary / file-size / build。

## 高级发现(已亲核代码属实)

### H1 遮罩永久卡死:回放块回调不查就绪锁

- 位置:`src/kernel/terminalReplay.ts:104`(提交 7389929)
- 类别:逻辑/竞态
- 问题:回放分块回调只判 `if (!cancelled)`,不判 `ready`。而三条撤罩路径(静默 :94、failsafe :126)都置 `ready = true` 后不再撤罩(live 事件 :82、`.then` :112、failsafe :125 均被 ready 短路)。回放中途遮罩被撤(实时字节静默 500ms 或回放超 12s 触发 failsafe)后,下一个回放块必重提遮罩,末块停在 100%,遮罩(inset-0 不透明层)永久盖住终端直至重挂载。
- 触发:回放期间到达实时字节后实时侧静默;或回放超 failsafe 时限。auto-activate 后台预开 PTY 使该场景更易复现。
- 测试盲区:`terminalReplay.test.ts` mock 恒 `getOutputBuffer: () => null`,回放分支零覆盖。
- 建议:`:104` 加 `&& !ready`;顺带 liveQueue 非空时 live 事件只累计 received 不调 onProgress,消 replay% 与已接收字节数的来回抖动。

### H2 应用内重启绕过 kill_all:孤儿 PTY 复发

- 位置:`src-tauri/src/lib.rs:56-58`(`app_restart`,d1f704f 引入的 `RunEvent::Exit → kill_all` 不覆盖此路径)
- 类别:覆盖缺失
- 问题:`app.restart()` 在主线程调用时跳过 `RunEvent::Exit` 直接重启(tauri 2.11.5 `app.rs:589-593` 实读,注释明示应改用 `request_restart`)。`app_restart` 是同步命令,默认主线程执行 → 插件市场「重启生效」(`PluginMarketPage.tsx:61`)重启后全部 PTY 子进程成孤儿,恰是 d1f704f 自述要修的泄漏。
- 建议:`app_restart` 改 `app.request_restart()`(可靠触发 ExitRequested+Exit),或重启前显式 `state.pty.kill_all()`。

## P1(建议随 H1/H2 一并修)

- `src/kernel/sessionSpawn.ts:283-292` + `src/kernel/sessionAdopt.ts:67`:silent 只压制 spawn 被拒广播;预开会话 20s 内秒退或装配竞态被删时,`emitIfStartFailed` 与 adopt 守卫仍无条件广播 `sessionStartFailed`,启动时刻逐条 toast,与 `autoActivate.ts:15`「silent 防风暴」自述相悖。修法:`AdoptPtySessionOptions` 增加 `silent`,`open()` 透传,两处 emit 在 silent 时跳过。

## P2 汇总(20 条)

### PTY 幕布(2)

- `TerminalView.tsx:267`:`Math.max(1, …)` 使零字节显示「已接收 1K」,应显「等待输出」。
- `TerminalView.tsx:276`:流式进度分母硬编码 5000,与可配缓冲上限(5 万-1000 万)脱钩;`terminalReplay.ts:34` 注释「相对输出缓冲上限」失真。

### 自动激活链(1)

- `autoActivate.ts:92-94` + `diskSessions.ts:141-157`:启动扫描先对每 工作区×profile 全量 `readHeadTitle`(浅 32KB 不中再深 256KB,无缓存)后按 days 窗口过滤,成本正比全部会话文件;大会话库时 8s 超时闸整组按空计。建议用 FileStamp.modifiedAt 在读头前预滤。

### 时间线(5)

- `TimelinePanel.tsx:73-75` + `cli-dsh/index.tsx`:dsh 未声明 `readSessionUserMessages`,时间线把「数据缺失」猜成「没有数据」(违反「缺失显示 — 不猜测兜底」铁则),应显「该引擎不支持」。
- `messageAnchors.ts:104-129`:tick await 期间会话被移除,恢复后 `cache.set` 复活已删缓存(仅内存残留,下次 sessionsChanged 修剪)。
- `TimelinePanel.tsx:5-6,219`:注释「挂载即订阅、切走即停表」不实,composer `AnchorRail.tsx:110-113` 常驻订阅,轮询启停与页签无关。
- `TimelinePanel.tsx:73-75`:无加载态,首 tick(至 32MB 尾窗)期间闪现「还没有用户消息」空态。
- `CheckpointsPanel.tsx:69-71`:切时间线页签后审批线 6s `refreshBatches` 轮询照跑(开销小,可免)。

### git diff(5)

- `DiffTabContent.tsx:39-59`:全文查看无体积护栏,巨文件整文件进内存 + 全量行 DOM,可冻结 UI 数秒;建议超阈(1-2MB)降级提示。
- `tests_commit_view.rs`:full=true 提交路径零 Rust 测试(工作区侧有同口径测试可照抄)。
- `WorktreeDiffPanel.tsx:77` / `CommitDetailsPanel.tsx:205`:分支对比弹窗不接全局 `git.diffMode`,恒单栏;若刻意宜注释声明。
- `E_[A-Z_]+:` 错误前缀剥离正则三处重复(DiffTabContent / CommitDiffTab / HistoryView),应收进 `gitError.ts`。
- `GitFilePatch.oldPath` 后端返回前端零消费(死数据),要么中央 tab 头展示 rename 来源,要么删字段。

### 会话扁平化(6)

- `useCliSessionGroup.ts:198-224`:`unpinnedCount/limit/disk` 三个返回字段无消费方,删。
- `SessionRows.tsx:60-65`:`LiveOutputDot` 注释「输出即绿」与实现矛盾(只渲染灰点且被全局隐藏)。
- `workspace/index.tsx:9`:文件头「状态圆点保留」注释失真。
- `SessionManage.tsx:168-176`:管理行裸 div 无 role/aria-checked/tabIndex,选中态对辅助技术不可见。
- `SessionManage.tsx:151-157`:批量归档 N 次 `updateSettings`、批量删除每行一次全量重扫,应合并为一次。
- `SessionManage.tsx:253-257`:「更多...」分页按钮与普通视图逐字重复,可提取共享。

### iconDecor + cli-shared(3)

- `settingsAppearance.ts:108`:注释称「空 item 剔除」实为保留 `{}`(代码是对的,改注释)。
- `diskSessions.test.ts`:64791ed 核心新增行为(两段式读头窗口)零测试,浅窗命中是否只读一次无锁定。
- `cli-codex/index.tsx:104,112`:`fsReadHead(4096)` 取 meta 后 `readHeadTitle` 又从 0 重读,重叠约 28KB/文件冗余 IO(报告性,可忽略)。

## 各主题无发现面(抽认)

- PTY:liveQueue 保序不丢字节;SSH(russh 进程内任务)/dsh(session_spawn 注册表)无漏杀;错误路径、冗余死代码、分块性能均干净;四笔演化无中间态死键。
- 扁平化:分组退役(GroupHeader/useGroupCollapsed/折叠 map/groups.css/旧 CSS 变量)全仓零引用删净;manage 状态机、轮次开启闸、架构通道全部合规。
- 自动激活:每组配额+总上限 16 分配算法与 spec 一致;sanitize 逐字段回落;演化链无死键;tab 容量滑杆关闭隐藏正确。
- 时间线:解析层(JSONL/轮次/时序/坏行/去重/保序)无发现;死代码无。
- git diff:diffMode 全链(sanitize/水合/持久化/契约测试)闭环;tokenRef 竞态防护齐;Rust full 贯通正确。
- iconDecor:订阅时序/StrictMode/非法值回落链路闭合;8 id 无死键;两段式窗口语义与 UTF-8 截断处理正确;架构(kernel 通用 map / cli-shared 收敛)合规;release 三处版本号与 CHANGELOG 一致。

## 处置建议

1. 立即修:H1、H2(各为小 diff,一处加条件、一处换 API)。
2. 随手修:P1 toast 风暴、dsh 时间线误报、零字节「已接收 1K」。
3. 择期:P2 测试缺口(回放分支、readHeadTitle、full=true)与冗余清理。
