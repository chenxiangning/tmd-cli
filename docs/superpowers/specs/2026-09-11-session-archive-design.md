# 会话档案馆设计:跨引擎会话检索 + 零进程只读回放 + 日志保留策略

- 日期:2026-09-11
- 状态:暂缓不排期(09-11 价值复核拍板先不做——回捞价值系于真实使用频率,各家 CLI /resume 已覆盖「搜到续跑」主场景;保留策略缺失的无界增长风险已知未处置。重启触发 = 磁盘失控可感知,或旧会话回捞真实撞墙)
- 分期:M1 元数据档案 + 检索 + 只读回放 + 保留策略(可独立发版);M2 全文 FTS5;M3 跨源出口

## 背景与目标

### 事实基线(2026-09-11 本机实盘)

- `~/.tmd-cli/session` 实测 **5.7 GB / 1296 个 `.log`**(09-11 午后复核);omp 占 5.6 GB,单文件最大 66.9 MB(64 MB 旋转闸的产物),最早文件 mtime 2026-09-02。**只写不删、无保留策略、无任何检索路径**。
- 现有全部能力都作用在「会话进行中」:composer 富输入、Ask 等待检测、审批线归因、只读状态栏、token 用量。会话 tab 一摘,可寻址信息只剩侧栏一行标题。
- 回捞路径逐一为空:⌘F 只在活幕布(xterm buffer 内);⌘K 是 CLI 命令真相源的抽屉;Memory 面板 FTS 只检索 Magic Context 记忆池,不检索转写;侧栏磁盘历史只按工作区 + 时间倒序分页(初始露出 = sessionListBudget 预算,默认 20 条),没有查询。
- 日志是 tmd 自有的 **PTY 字节副本**,与 CLI 私有格式无关 —— 检索它不触碰「内核不理解 CLI 私有格式」这条铁律。

### 目标

把「跑过的会话」从一次性显示变成可回捞的资产,同时止住磁盘无界增长。三条判据:

1. 能在 5 秒内回答「上周那次 hydration bug 是怎么定位的、哪个引擎、说了什么」,并直接看到当时的真实画面。
2. 回捞动作**不预付任何 CLI 进程**(对齐 09-09 磁盘先行回放的内存结论)。
3. `~/.tmd-cli/session` 占用有上限、有可见性、可一键清空。

### 非目标

- 不做「本机所有 CLI 活动的统一历史」。档案馆的语义边界 = **在 tmd 里看过的会话**;在系统终端里裸跑的 CLI 不在范围内(M3 若要做,走插件声明式语料出口,不入内核)。
- 不做结构化消息渲染(气泡 / Markdown / diff 二次渲染)。09-09 走法 2 的否决继续有效。
- 不做会话 fork / 时间线分支(opcode 式),不做导出分享。

## 方案取舍

### 一、检索语料源

| 方案 | 内容 | 裁决 |
| --- | --- | --- |
| **A(选定)** | 索引 tmd 自有 PTY 日志 `~/.tmd-cli/session/<engine-slug>/<cwd-slug>/<logId>.log` | 引擎无关、零私有格式知识;是 PTY 路线攒下的唯一红利;命中即可原样回放成真实画面 |
| B(否决) | 直接索引各家 CLI 的 session jsonl | 内核/索引层必须理解 claude/omp/codex/kimi/qoder/grok/opencode 七种私有行型 = 违铁律;且正是当年弃坑 codemoss 的「每 CLI 一份解析器」适配矩阵债(见 `docs/research/memory-usage-analysis.md` 走法 2 否决先例) |
| C(延到 M3) | A 为主 + 各 cli-* 插件声明「语料提供者」补口 | 覆盖面补口只允许经 `cli-shared` 声明通道(`diskSessions` 下沉先例),索引层不认具体 CLI |

### 二、命中后的呈现方式(本 spec 最关键的一处取舍)

| 方案 | 内容 | 裁决 |
| --- | --- | --- |
| **甲(选定)** | 新增**档案只读 tab**:零进程,纯 `read_history_page` 分块回放到 xterm,不参与会话生命周期 / Ask 检测 / 审批线 / tab 容量 | 「查历史」的意图是看不是续跑;只读且可多开;要续跑由 tab 内「继续这个会话」显式冷开 |
| 乙(否决) | 复用磁盘会话冷开(`prefetchDiskTail` + 后台异步 resume) | 冷开会后台拉起真 CLI 进程。搜索时连点十几条命中 = 十几个进程,正面撞 09-09 内存事故结论(19 个 bun omp = 4.9 GB) |
| 丙(否决) | 命中只给文本片段,不出画面 | 丢掉幕布保真这一立身差异化,变成又一个 transcript 阅读器 |

### 三、全文索引引擎(M2)

- **选定:SQLite FTS5,`tokenize='trigram'`**。本机实盘核实:`src-tauri/Cargo.toml` 已依赖 `rusqlite 0.40 (bundled)`;`libsqlite3-sys 0.38.2` 的 `build.rs:159` 已带 `-DSQLITE_ENABLE_FTS5`,bundled SQLite 版本 **3.53.2**,trigram 可用。trigram 对中英混排免分词、支持子串,是中文检索的唯一可行解。
- 否决 `unicode61`:中文整句被切成单 token,查「修复侧栏」召不回,等于没有全文。
- 否决外部 ripgrep 子进程现场扫盘:5.7 GB 全扫不可接受(`fs_walk.rs` 的 `ignore` 引擎解决的是文件枚举,不是全文);`proc_run` 冷启动 + 无排序无排名。
- 代价须写明:trigram 索引体积约为语料的 1.5-2 倍,且查询词 < 3 字符不命中(前端按「过短则退化为元数据检索 + 提示」处理)。**这条代价直接决定 M1 的保留策略必须先于 M2 落地**,否则索引库会把磁盘再顶大一倍。
- 回落:若 bundled 配置有变导致 FTS5 不可用,退化路径是分片 `LIKE` 扫(仅元数据表 + 每文档摘要列),不引入新依赖。

### 四、UI 归位

- 选定:中央 tab(检索 + 结果列表)+ 侧栏快捷动作入口 + 设置页「行为」新分区(保留策略 / 占用 / 重建 / 清空)。
- 否决右栏面板:结果需要 snippet 与多列元信息,右栏宽度撑不住;且右栏 tab 已有 Git / files / checkpoints / memory / ssh 五家。
- 否决并入 ⌘K 命令抽屉:抽屉语义是「CLI 命令真相源 + 插件切换」,塞入历史检索会污染那个契约(`listSuggestions` 声明优先规则)。
- 否决查询语法式过滤(`#engine` `@ws`):与 composer 触发符体系抢语义,首期用 facet 下拉芯片。

### 五、内核准入

新插件单消费者,**索引语义不入 kernel**。内核改动只有 `src/kernel/ipc.ts` 新增 3 条命令封装(R3 唯一 import 点的既有模式)。若 M3 出现第二个消费者(memory-coordinator 想在蒸馏前查重),再把契约下沉 `cli-shared` 或 kernel,按先例走。

## 设计

### 数据流

```text
PTY 字节日志 <logId>.log  ──┐
  ├ .logptr(cliSessionId → 最新代 logId)   现有件,零改动
  └ 会话身份 = (profile_id, cwd_slug, cli_session_id)
                              │ M1: 建表 + 元数据抽取
                              ▼
              ~/.tmd-cli/archive/index.db   (rusqlite bundled)
                 doc(...)             会话级元数据:标题/首条 prompt/时间/引擎/工作区
                 segment(doc_id, seq, raw_base, raw_len, norm_len)   M2 用
                 doc_fts / seg_fts    FTS5(trigram)
                              ▲
        启动后台单飞增量 ──────┤  会话结算(turnSettled)/退出追加
        删除会话 / 保留逐出 ───┘  同步行删除
                              │
              ipc.ts: archive_query / archive_stats / archive_log_page ...
                              ▼
        src/plugins/archive/  检索 tab ──「只读打开」──▶ 档案只读回放 tab
                              └─「继续这个会话」──▶ 现有磁盘会话冷开(带进程)
```

### M1:元数据档案 + 只读回放 + 保留策略

Rust 新增 `src-tauri/src/archive.rs`(≤300 行,超出按既有风格拆 `archive_scan.rs` / `archive_prune.rs`,单测落 `archive_tests.rs`,先例 `installer_tests.rs` / `proxy_tests.rs` / `plugins_tests.rs`):

- `archive_rebuild(mode)`:全量重建。扫 `~/.tmd-cli/session/<engine>/<cwd>/*.log`,文件名即 `<logId>`(现网形态 `18d420deffde4d88-2-0d4e107b87c88a91`),再扫同目录 `<cliSessionId>.logptr`(文件名即 cli_session_id,内容 = 当前代 logId)建反查 → 一行 `doc`。元数据 = `(profile_id, cwd_slug, log_id, cli_session_id, path, size, mtime_ms, session_ts, title, first_prompt)`。
- **标题与首条 prompt 不在 Rust 侧解析**:Rust 只回原始字节窗口(`archive_log_head(log_id 路径组件, bytes)`),`title` / `first_prompt` 由前端用**已有的**磁盘会话标题解析链(`cli-shared` 的 `extractJsonlTitle` / 标题四级链同源)算好后回写。理由:内核与 Rust 一律不碰 CLI 私有格式,归一化与展示语义留在前端契约层。
- `archive_query(filter)`:facet 组合过滤(引擎 / 工作区 / 时间窗 / 关键词按 `title||first_prompt` 的 `LIKE` —— M1 不建全文表),按时间倒序 + 分页(默认 50,与侧栏预算语义独立)。
- `archive_stats()`:总条数、总字节、索引库字节、最早/最新 mtime、逐出候选数 —— 供设置页与「档案馆已占用 X GB」。
- `archive_prune(max_bytes, ttl_days, exempt_ids)`:与 checkpoints prune 同构(条数 + TTL 双闸,`docs` 侧已有先例语义),**默认 2 GB / 60 天**。豁免:已置顶、已归档、以及 `~/.tmd-cli/checkpoints/<md5(cwd)>/ledger.jsonl` 里仍被引用的 cwd 的近 7 天日志。删除只动 tmd 副本,CLI 自身会话文件不受影响 —— 这是「默认开」的安全论证。
- 增量:`kernel.sessions.exited`(payload 是裸字符串 sessionId,注意不是对象)与轮次结算时,对该会话日志按 `(size, mtime)` 水位追加/更新行;同 size 同 mtime 直接跳过,不重读盘。

`ipc.ts` 新增:`archiveRebuild` / `archiveQuery` / `archiveStats` / `archiveLogPage` / `archivePrune` / `archiveClear`。回放取段复用 `session_log::read_history_page`(已是纯函数)+ `session_disk_log::validate_component` 的路径组件闸,新增一个「按 logId 直读窗口」的原生命令(现有 `session_history_page` 需要活会话 Rust id,冷档没有;`read_disk_tail` 只认指针最新代,多代会漏 —— 注释里写清为什么不复用 `read_disk_tail`)。

前端 `src/plugins/archive/`(feature 类,`allPlugins` 注册一行):

- `index.tsx`:`registerTabContent`(检索页 + 只读回放页两种 content kind)、`registerSidebarAction`(侧栏入口)、`registerCommand({ id: "archive.search", keybinding: "Cmd+Shift+F", scope: "global" })`(已核对现网键位表未被占用)、`registerSettingsSection`(行为分区:占用/重建/保留上限/TTL/一键清空)。
- `ArchiveSearchTab.tsx` / `ArchiveResults.tsx` / `ArchiveReplayTab.tsx` / `useArchiveIndex.ts` / `archive.css` —— 单文件 ≤300 行,超过继续拆件(react-doctor 治理原则:拆件优先于加注释豁免)。
- 结果行:时间 + 引擎品牌图标(`fileVisual` / Glyph 同源,品牌色已烘焙)+ 工作区别名 + 标题(缺则首条 prompt 截断)+ snippet + hover 双动作「只读打开」「继续这个会话」。
- 只读回放 tab:分块喂 xterm,**复用 `diskReplay.ts` 的 512 KB 窗口常量与 `terminalReplay` 保序机制**;输入闸全关(无 PTY 可写);「加载更早」按钮直接映射 `read_history_page` 的 `startOffset/hasMore`。
- 「继续这个会话」才走现有磁盘会话冷开路径(带进程),并显式提示会拉起 CLI。

### M2:全文

- 归一化入库:剥 ANSI(**复用 `askWatchCore` / `editWatch` 已有的剥 ANSI + 跨分片拼行实现,不再造第三套**)→ 折叠连续重复行与纯重绘残帧 → 按 256 KB raw 窗口切 `segment`,记 `raw_base`。
- `seg_fts` FTS5(trigram),`content=` external-content 表,`offsets()` 给 chunk 内位置。
- 命中定位语义要老实:**首期只定位到「命中所在 raw 段附近」**(段粒度 256 KB),回放窗口取 `raw_base ± 段`,snippet 用 `snippet()` 出。精确到行留给二期:在命中段内对 raw 窗口现算一次归一化再对齐(成本可控,不预先存映射表 —— 那会把索引再撑大一倍)。
- 同 doc 相邻命中合并,避免一次搜索出 40 条同一轮重绘的碎片。

### 设置项(全部落 `~/.tmd-cli/settings.json`,走现有 sanitize 归一 + 非法回落)

- `archive.enabled`(默认开)、`archive.maxLogBytes`(默认 2 GB)、`archive.ttlDays`(默认 60)、`archive.indexFullText`(M2 默认关,可选开)。
- i18n 三语词条齐全(全库文案已走 `kernel/i18n t()`)。

## 风险与对策

| 风险 | 对策 |
| --- | --- |
| 5.7 GB 首扫耗时与内存 | 后台单飞 + 分批(每批 ≤8 文件 / ≤64 MB)+ 活会话写入期让路;峰值 RSS 闸 ≤200 MB;进度可查可暂停 |
| TUI 日志含大量重复残帧与转义噪音,命中不可读 | 归一化 + 相邻命中合并;宁滥勿漏(漏检比误检贵),snippet 渲染前再剥一次控制序列 |
| trigram 索引把磁盘再顶大一倍 | **保留策略(M1)先于全文(M2)**;索引库体积进 `archive_stats` 可见;提供只建元数据的降级档 |
| 隐私:档案馆 = 明文可检索历史(可能含粘贴过的 key) | 与现存 5.7 GB 日志同级风险,不新增暴露面;零网络;设置页一键清空;清空与逐出都不碰 CLI 自身文件 |
| 多代日志(logId 换代)导致同一 CLI 会话多份副本重复命中 | `doc` 按 `(profile_id, cwd_slug, cli_session_id, logId)` 建行,检索按 CLI 会话身份聚合去重,展示最新代 |
| 与 09-09 内存结论冲突(多 xterm 常驻) | 只读回放 tab 数上限(默认 3,超出关最早),与 tab 容量语义正交 |
| Windows/Linux 平台路径与 slug 差异 | 复用 `project_slug` 与 `architecture/04-windows-platform-contract.md` 的会话 slug 契约;交叉编译本机验不了,按惯例 tag 触发 CI 三平台验 |

## 验证

交付前必跑(AGENTS.md §2):

- 前端:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`
- Rust(在 `src-tauri/`):`cargo test && cargo clippy --all-targets -- -D warnings && cargo fmt --check`

具体闸口:

1. **Rust 单测**:`archive_tests.rs` —— 增量水位(同 size+mtime 不重读)、trigram 中英命中、`raw_base` 段定位往返、路径组件拒绝(`..` / 分隔符 / 空串)、prune 边界(TTL / 上限 / 三类豁免)、多代去重、`logptr` 缺失回落扫目录。
2. **前端单测**(`*.test.ts(x)` 同目录先例):facet 组装、snippet 高亮与再剥控制序列、只读 tab 上限逐出、设置四字段 sanitize(非法回落)、`archive_*` 命令失败降级为「只显侧栏磁盘历史」不白屏。
3. **桩目检**(1421 dev + 浏览器 Tauri 桩,配方见既有实证):桩放行 `archive_query`(回 3 条混引擎假档)/ `archive_stats` / `archive_log_page`(回 `{text, startOffset, hasMore}`);断言结果行渲染、facet 过滤、只读 tab 出画面、侧栏入口、设置分区出现「已占用」。注意 `session_log_page_raw` 与 `archive_*` 都要在桩的 fallback 里回合法形状,数组消费方一律回 `[]` 不回 `{}`。
4. **真窗实测**(UI 行为改动硬要求 `pnpm tauri:dev`):搜一个只存在于 2026-09-02 老日志里的字面量 → 命中 → 只读回放画面正确且**进程数不变**(`pgrep -f omp | wc -l` 前后对比)→ 点「继续这个会话」才拉起 → Ask 检测与审批线在只读 tab 上零触发。
5. **性能闸**:首扫 5.7 GB 记录墙钟与峰值 RSS;增量单文件 ≤50 ms;逐出后目录占用 ≤2 GB。
6. **回归红线**:侧栏磁盘历史、⌘F 幕布搜索、⌘K 抽屉、Memory 面板检索四条既有链路行为零变化。

## 配套文档义务

- 落地后沉淀 `docs/architecture/08-archive-index.md`(索引表契约 + 归一化规则 + 段定位语义)。
- 随本 spec 一并修 09-09 评审整改清单里 FEATURES 的陈旧行(第 38 / 64 行、工作区会话域三行、缺录的 0.1.3 六项),以及 `docs/FEATURES.md:359`「改键 UI 未实装」与 `README.md:85`「可视化改键」的矛盾(改键早已落地:`kernel/shortcutOverrides.ts` + `settings/ShortcutTab.tsx`)。

## 未决项

- 工作区别名:前次未决已消解 —— `2026-09-09-workspace-alias-design.md` 已落地(commit 9ed4911),档案结果行直接消费现有工作区别名链,本期零额外工作。
- 归档 / 置顶会话是否默认无限期豁免逐出(现为豁免,但用户可能希望归档即代表「不必留字节」)。
- M2 精确行定位是否值得存 per-segment 位置映射(体积 vs 体验)。
- 是否把 token dashboard 的「Top 会话榜」(09-11 spec 二期候选)复用 `doc` 表,做成档案馆结果页的一种排序。
