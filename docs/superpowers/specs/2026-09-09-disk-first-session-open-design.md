# 磁盘会话先行回放 + 进程惰性拉起设计(走法 1)

- 日期:2026-09-09
- 状态:已落地 —— `165b4d4`(主实现 + 拆自动激活)+ `966271a`/`848ee7b`(白屏时序修复:墓碑帧/连接遮罩保持到 CLI 首帧画完,清屏序列 `\x1b[2J` 后 300ms 一次切换)。真机内存验收:冷启零预付 ≈0.5GB,22 分钟活跃态(实开 8 会话)整树 2.15GB,对照旧架构 3h 6.7GB→11.86GB 轨迹;WebContent 1.4GB → 330MB。
- 关联:动机与实测见 `docs/research/memory-usage-analysis.md`;评审记录 `docs/review/2026-09-09-disk-first-session-open-review.md`;`2026-09-08-auto-activate-recent-sessions-design.md` 已废除。

## 背景与目标

自动激活(预开 16 个 CLI 进程,实测整树 6.7GB/3h)的根因是「看会话 = 必须有活进程」。本设计在 PTY 幕布哲学内(零引擎适配)解耦「看」与「跑」。

**关键事实(已核实)**:spawn 注册只是分配 uuid + fork/exec + 注册表,百毫秒级;今天「点开慢」的 1–3s 是**幕布空白等 CLI resume 自绘**。所以不需要重排点击路径,只需要用上一代磁盘日志的尾巴把这个空白填上。

目标:

1. 有日志的磁盘会话点击,**回放解析完成即可见画面**(目标 <300ms,见就绪锁节);零预付进程、零设置;
2. 「只看不说」的会话零进程开销;
3. 自动激活整体下掉(大仙 2026-09-09 拍板),顺序 = 本设计验证后再拆。

## 方案取舍

选定:**A. 预取式磁盘尾回放**——点击瞬间 prefetch 上一代日志尾(不 await),openDiskSession 照旧走 spawn,挂载后异步消费预取尾巴走回放分支。

否决:

- **B. 挂幕后拉取**:挂载时 bindIdentity 已把指针更新到新(空)日志,读到空;须加代际排除,复杂化。
- **C. 日志按 cliSessionId 命名 + 绑定时 rekey**:动热追加路径 + 绑定时机竞态,收益 = 省约 40 行,风险不对称。
- **D. transcript 结构化视图(codemoss 同款)**:每 CLI 一份解析适配器,违反零适配立身之本。
- **E. pending 会话/先挂幕后 spawn**:需拆 Rust 注册表两阶段;spawn 注册不慢,失去必要。
- **F. webview 重载空幕布修复(原附加项,v1 曾误列)**:前提错误——tab 本无跨重载持久化机制(`sessionTabs.ts` 纯内存,重载即清),「boot 恢复 tab」无处挂靠。若将来做 tab 持久化,重载恢复应走 `session_history_page` 按 tmd 会话 id 直读(bootAskRestore 同款原语,不经指针),单独立项。

## 设计

### 点击链路

```
点击磁盘行(SessionList)
 ├─ diskReplay.prefetch(profileId, cwd, cliSessionId)     // 不 await;IPC 失败静默
 │    → ipc.sessionDiskTail → Rust 解指针读上一代日志尾(≤512KB)
 ├─ host.openDiskSession(...)                             // 照旧:spawn 注册(~百ms)→ adopt → setActive
 └─ activeSessionChanged → tab → TerminalView 挂载
      → 挂载即 consume 预取 promise(不删槽,见单槽节) → resolve 后选分支:
          有尾巴 → 回放分支:liveQueue 持续攒实时字节(挂载起就攒,不许直写)
                   → 输入闸开写时才 arm → 分块回放(进度遮罩) → 回放尽即撤罩落就绪锁
                   → host.restoreTail(sessionId, tail)   // Ask 徽章磁盘恢复
          无尾巴/失败 → 现状 else 分支(直流式 + 静默判就绪)
      → liveQueue 按序补写;CLI resume 重绘盖过墓碑帧
```

**异步接缝(评审 F3,必须照此落地)**:`attachTerminalStream` 现有 99 行是同步读缓冲;磁盘尾巴是异步源。consume 返回 promise 期间,实时订阅必须已在攒队(liveQueue 语义从「回放期间攒」提前为「挂载起攒」),严禁 promise 未决时走 else 直写——否则实时字节先写幕布、回放后到即交错。

**就绪锁(评审 F1p)**:磁盘回放分支**回放完成即撤罩并落 ready 锁**——墓碑帧本身就是内容,不等 500ms 静默(CLI resume 首字节 1–3s 后才到,等静默会把可见画面拖到 ~1s)。内存回放分支维持现状语义。验收口径「<300ms」按回放解析完成计,可达。

spawn 失败:维持现状(toast、无 tab、无回放)。

### 单槽预取(评审 F2 修订)

`kernel/diskReplay.ts`:一个 slot = `{ cliSessionId, promise }`,新预取覆盖旧槽。**消费不删槽**——删槽会在 StrictMode 双挂载(dev)下丢回放;槽只被下次 prefetch 覆盖,重挂载时内存缓冲非空走内存分支,陈旧槽无风险。消费时按 `host.getCliSessionId(sessionId)` 解析标签,不匹配 = 不消费。已知降级(P2,接受):亚秒内连开两个不同会话,先开的会丢回放回落现状。

### Rust(约 60 行 + 测试)

- **指针文件**:`~/.tmd-cli/session/<slug(profile_id)>/<cliSessionId>.logptr`(目录是 profile slug,非「引擎」,评审 F6),内容 = 当前代日志 id(uuid)。写入命令 `session_link_log(profile_id, cwd, cli_session_id, log_id)`,**无条件写**(不 gate bindIdentity 返回值,与 `sessionSpawn.ts:265` 现状一致);内容与 cliSessionId 均拒绝路径分隔符/`..`(信任边界,一行校验)。
- **读取命令** `session_disk_tail(profile_id, cwd, cli_session_id, max_bytes) -> Option<HistoryPage>`:解指针 → 离线读语义 `base=0, written=file_len, before=file_len` → 复用 `read_history_page`(转义序列/UTF-8 双边界对齐现成);指针或文件缺失 → `None`。**契约:返回的 startOffset/hasMore 是文件相对假绝对偏移,消费方只准用 text;max_bytes 服务端 clamp ≤1MB。**
- ssh 分支不做(无磁盘身份);旋转后读尾天然正确(rotate 保留尾部 KEEP 字节,`session_log.rs:92-106`)。

### kernel / 前端

- `terminalReplay.ts` 回放源改造:按「异步接缝」节落地(挂载起攒队 + resolve 后选分支 + 磁盘分支回放尽即 ready)。
- 指针写入两个调用点:adoptSpawned 的 bindIdentity 后(openDiskSession 路径)、identityWatch 绑定后(createSession 路径),各一行 `void ipc.sessionLinkLog(...)`;绑定失败的会话无指针 → 磁盘尾 None → 回落现状(接受)。
- **restoreTail 写后闸(评审 F4)**:距该会话 `lastWriteAt < ASK_REARM_SUPPRESS_MS`(8s)则跳过 restoreTail——防「回放窗内 composer 作答清候选 → 尾巴晚到立新候选 → 静默升级假 waiting」。约 4 行。
- `TerminalView` askProbe:回放/流式相位(至 ready)停采,经 **ref** 读相位(React state 闭包读不到新值,评审 F5);理由是防墓碑帧进屏幕通道与 restoreTail 双源,状态机互认已挡大半,此为收口。

### 状态纪律(两条红线,评审确认无泄漏路径)

1. **磁盘回放字节永不进 `appendOutput`**——历史字节会误开轮次、误置未读、误升级 ask waiting、误触 editWatch。已核:回放分块直写 term、restoreTail 只进 askWatch、live 字节经常驻订阅独立走 appendOutput,三路互不交叉。
2. **输入闸沿用现状**:回放窗内幕布击键/查询应答一律丢弃;composer 不经闸(现状),其与回放窗的交互由上面的 restoreTail 写后闸兜住。

### 自动激活下掉(本设计验证通过后,独立提交)

拆(全库 grep 核实):`main.tsx:23,50` boot 钩子、`kernel/autoActivate.ts` + 测试、`settingsTypes.ts`(类型 + 6 常量 + 默认值 + 字段)、`settingsSanitize.ts` 的 sanitizeAutoActivateSessions、`settings.test.ts:58,203-211`、`plugins/settings/BehaviorAutoActivate.tsx` + `BehaviorTab.tsx:23,242` 挂载点、locales 字典三条设置文案、`FEATURES.md:29`、**`open/openDiskSession` 的 `activate/silent` opts 整体删除**(评审 F7:silent 唯一消费方是自动激活;activate:false 亦然,删除后去重分支恒聚焦,`sessionAdopt.ts` silent 分支、`sessionSpawn.ts` silent 全链、`sessionSpawn.adopt.test.ts:142-160`、`host.test.ts:233-268` describe 改写为去重聚焦契约)。留:`d1f704f` kill_all 清场。

## 前置任务梳理(实施顺序)

**P0 写代码前核实**

1. spawn 注册耗时打点(真机 + 桩):确认「点击→挂载」预算百毫秒级;超 ~500ms 的 profile(dsh 类 host-RPC)回落现状——走法 1 只对声明 `resumeArgs` 的本地 CLI profile 生效。

(原 P0-3「restoreTail 自愈闸」经评审证伪:restoreTail 经 `watch.onOutput` 正常推 bytesIn/lastOutputAt(`askWatchCore.ts:96-99`),自愈判据与 bytesIn 无关,该项销。真实风险已转为 restoreTail 写后闸进设计。)

**P1 实施**

2. Rust:`session_link_log` + `session_disk_tail` + 单测(指针缺失/路径分隔符拒绝/离线读语义/clamp/旋转后)。
3. kernel:diskReplay 单槽 + terminalReplay 异步接缝改造 + restoreTail 写后闸 + askProbe ref 停采 + 两处 link_log 调用点。
4. 测试:红线回归(磁盘字节不入 appendOutput——断言 activityWatch/editWatch 零触发)、diskReplay(标签错配/rejected/覆盖/StrictMode 双消费)、terminalReplay 源选择时序(promise 未决期 liveQueue 攒队/磁盘分支回放尽即 ready/无尾回落)、restoreTail 写后闸;全链 `pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build` + `cargo test && cargo clippy --all-targets -- -D warnings && cargo fmt --check`。
5. 桩目检(1421):点击磁盘行 <300ms 回放完成;墓碑帧 → 实时接管无交错;Ask 墓碑帧徽章恢复 + 活流确认;composer 回放窗作答不产假 waiting;spawn 失败 toast;至少 claude/omp 双引擎。
6. 真机目检 + 内存复测(ps 树合计 + vmmap,对照研究文档实测表;验收:冷启 10min 整树 <1GB)。
7. 自动激活拆除(独立提交)+ CHANGELOG + docs 索引更新。

**风险**

- 墓碑帧与 CLI resume 自绘的视觉接缝(双历史残影):逐引擎桩目检验收,必要时调回放窗口字节数。
- 日志刚旋转后墓碑帧残缺:live 流随即接管,可接受。
- 无日志磁盘会话(旋转截没/未经 tmd-cli 开过/绑定失败):回落现状路径,无回归。
- 读尾与追加并发:边界对齐兜住,极端撕裂帧被 live 重绘覆盖,可接受。

## 验证

- 全链验证命令见前置任务 4;UI 行为改动按铁律 `pnpm tauri:dev` 真窗目检。
- 验收口径:① 点击磁盘会话回放解析完成 <300ms(桩环境 performance 打点);② 冷启 10min 整树物理占用 <1GB;③ 长运行 3h 整树 <3GB;④ Ask/未读/状态标签零回归(桩断言)。

## 拍板结果(2026-09-09,大仙)

1. 语义 = **点击即后台 spawn**(首条消息零等待;进程数由「实际点开的会话数」天然封顶)。
2. 辅线三件套**不随本设计**——挂起,待主线落地后以 vmmap 实测数据再议(若做,按 滚回降配 → 停解析 → 降频 顺序逐件独立上)。
