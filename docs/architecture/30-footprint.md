# 30 - footprint(每日工作足迹)落地架构契约

- 日期:2026-10-20
- 状态:已落地(v0.4.0,tag v0.4.0 起);设计 spec 与被否方案见 `docs/superpowers/specs/2026-10-19-footprint-design.md`
- 本文是 footprint 插件的唯一架构事实源;与代码矛盾时以代码为准并顺手修订本文。

## 插件身份

- 目录 `src/plugins/footprint/`;注册于 `src/plugins/index.ts` 的 `allPlugins`(id `footprint`)。
- `activate(ctx)` 贡献三面:`ctx.registerTabContent`(中央 tab,`lazySuspense` 挂 `FootprintView`)+ `ctx.registerSidebarAction`(左栏按钮,order 46)+ `ctx.events` 订阅封口事件驱动 rollup 写侧。
- tab 机制 `fpTab.ts`:`FP_TAB_KIND = "footprint.daily"`,经 `@kernel/tabs` 的 `openTab` 幂等打开;`bumpFootprintRev`/`useFootprintRev`(模块级 rev + `useSyncExternalStore`)做 live 刷新信号,封口事件即 bump,视图与顶栏「回到今日」共用 `gotoToday`。

## 四数据链(读写分工)

| 链 | 内容 | 写侧 | 读侧 |
|---|---|---|---|
| L1 | 改动 rollup(按日 ±/会话/批次) | footprint 写:订阅 `KernelTopics.ckptTurnSealed` | 同文件月缓存 |
| L2 | 会话行 / journal 产物 | workbench/journal(零改动,纯复用) | 经 `@plugins/workbench/journal` 适配器 |
| L3 | 功能卡(标题/一句话/原话锚点/sessions) | journal 生成会话顺手直写(管线 A) | 读侧校验(管线 B) |
| L4 | 区间 git 提交 | 无(只读) | 唯一新 Rust 命令 `git_repos_log_range` |

### L1 rollup 写侧(核心契约)

- 磁盘:`~/.tmd-cli/footprint/YYYY-MM.json`(月一文件)+ `footprint/features/YYYY-MM-DD(.user).json`(功能卡)。
- 触发:仅消费 kernel 事件 `ckptTurnSealed`(checkpoints `sealTurn` 后端确认真实封口后广播,代封不广播)——footprint 不理解封口内部时序,不直接 import checkpoints 生命周期。
- 串行:单飞 promise 链(`queue = queue.then(handleSealed).catch(warn)`),单轮失败不毁链;`handleSealed` 经 `ipc.checkpointList` 取最新已封口且会话匹配批 → `settleKey`(跨零点归事实时刻)→ `mergeBatchIntoDay`(files 按 path 累加 ±、refs 并集、sessions 记 engine/cwd/turns、batches[sid]=批 id)→ 写盘。
- 月缓存:LRU 3 个月,写侧标脏 → 写盘 → 标干净;读侧 `getMonth` 共享同一缓存,损坏宽容跳过;无独立 TTL。

### L3 功能卡

- 管线 A(直写):journal 生成会话与日报同任务直写第二个 JSON(`featuresPath` 由 `journalFiles.featureCards` 给出,缺省 = 契约段整体省略)。契约铁律在 prompt 段:sessions/quote.sid 只能引用摘录头真实会话 id、增量日旧卡 title 冻结、单日 1-8 张、quote ≤60 字。
- 管线 B(读侧校验):`validateFeatureCards` 逐卡对照当日会话枚举(`knownSessionIds` = rollup sessions ∪ journal 行 id),未命中标 `unverified`(UI 徽标「会话引用未验证」);档缺失/损坏/version≠1 视为无卡,不猜测兜底。
- 修正层(管线 D):`.user.json` 整文件覆盖 AI 原档(删 `.user.json` 即恢复);合并/拆分/手动补归纳/改名全部纯函数 + 整量写(`useFpFix.ts` 的 mergeCards/splitCard/submit*),补归纳允许不带会话引用;读侧双档探测来源徽标——user+AI 都在 =「已修正」,仅 user =「手动」,否则「AI 归纳」。

### L4 Rust 面

- 唯一新命令 `git_repos_log_range(root, since, until) -> Vec<RangeCommit>`(`src-tauri/src/git/repos_log_range.rs`):复用 `repos_scan` 仓发现(root 自身排首位、深度 2、上限 32),git2 revwalk 按 committer 时间窗过滤,thread::scope 逐仓并行,单仓失败整仓省略;窗口两端由前端 `toISOString()` 生成。
- 其余零新增:diff 复用 `ipc.checkpointBatchDiff`(钥匙 = rollup.batches,失败 null 降级)、rollup 写盘 `fsWriteFile`、区间提交经 `ipc.gitCommitsRange` 封装。

## 读侧分层(单插件内)

```
types.ts     类型 + isCfgPath/settleKey 纯判定
rollup.ts    写侧 + 月缓存 getMonth(L1 唯一磁盘知识)
query.ts     日明细/月热力/区间汇总/monthSpan/四来源搜索/卡校验(现场经 getMonth)
dataSource.ts UI 聚合纯读(loadDayDetail 一次拉齐;searchDays 摊平前按 kind 稳定归并)
view/        FootprintView → FpTopbar / MonthCal / DayFlow(+RangeFlow)/ EvidenceDrawer+FpMainDiff
             / FpOverlays(SearchPop/帮助/修正菜单/改名/toast)/ FixModals;useFpKeys/useFpFiles/useFpData
```

- 搜索四来源(功能卡/用户原话/日报/文件路径):`query.searchFootprint` 按日分组,`dataSource.searchDays` 摊平前按 kind 主序稳定归并(SearchPop 组头渲染要求同 kind 相邻),日倒序,上限 40。
- 抽屉会话行排序键:`rollup.sessions[sid].first`,缺省回落 journal 行 `startedAt`。

## 跨插件 import 准入清单(架构边界)

- `@kernel/*`:ipc(checkpointList/checkpointBatchDiff/gitCommitsRange/fsWriteFile)、events(ckptTurnSealed)、plugin(注册面)、tabs/lazyTab、i18n、fsDirs/workspace/workspaceOrigins/settings/openWith —— 全部公共面。
- `@plugins/workbench/journal`:daySessions/journalFiles/sessionRef/journalTabs —— footprint 唯一出向跨插件依赖,理由 = journal 是 L2/L3 同源数据属主(featureCards 路径、dailyPaths 同源,resume 复用;journalTabs = 2026-10-20 双向深链「打开日报 ↗」复用 openArticleTab 深链契约)。footprint 的 journal 产物路径禁止硬编码前缀,一律经 `dailyPaths()`(2026-10-20 评审修:死前缀致 article 恒 null)。
- 反向边 journal → `@plugins/footprint/fpTab`(2026-10-20 双向深链,spec `2026-10-20-footprint-journal-deeplink-design.md`):journal 轴视图 DayCard「足迹 ↗」调 `openFootprintTab({ day })`。fpTab 仅依赖 kernel(i18n/tabs)+ dataSource 纯函数 `dayKeyOf`;journal 侧叶子模块(daySessions/journalFiles/sessionRef)不回指上层,无模块环。口径 = 数据依赖单向(footprint 读 journal),导航双向。
- Rust 侧零 checkpoints 私有知识:封口批次只经 `ipc.checkpointList` 通用 IPC。

## tab 深链 payload(2026-10-20 双向深链)

- `FootprintTabPayload { day?: "YYYY-MM-DD" }`(dayKeyOf 同格式零填充);`openFootprintTab(opts?)` 内部 `openTab(..., { refresh: true })` —— 已开 tab 原地刷 payload 并激活,新开按 payload 初始化。
- `FootprintView` 收 `{ tab }`:mount 期 payload.day 进 useState 初始值(非法日回落今日);已挂期 render 期 payload 比较(`useArticleEditSignal` 先例)→ 退出区间态 + 跳日 + 清卡片/文件选中/焦点。
- 日视图日报行:`detail.article` 存在即渲染(首行标题 + 「打开日报 ↗」),消费 `loadDayDetail.article`;digest 不进当日视图(原话锚点来自 features JSON,⌘K 搜索另读文件),已自 `FpDayDetail` 删除(2026-10-20,死载荷清理)。

## 主题 / i18n / 键盘

- 主题:全 `--tmd-*` token,不用硬编码色;violet 系用 `--tmd-syntax-tag`、amber 系用 `--tmd-warn`(双主题各自正确);透明度走 `color-mix(in srgb, … N%, transparent)`;热力五档 `HEAT_SCALE` 用 token 梯度。教训(v0.4.0 评审):臆造 `--tmd-green-weak` 类不存在变量会回落实色致不可读。
- i18n:`locales/{en,ja}.ts` 键 = 中文源串,`locales/index.ts` import 即注册(先例 workbench/journal)。
- 键盘 `useFpKeys`:容器级 onKeyDown,不注册全局 shortcuts 不抢输入框;⌘/Ctrl+K 搜索、Escape 逐层退(搜索→帮助→修正→抽屉,弹层 stopPropagation)、←/→ 换日(+shift 换月)、j/k 卡导航(区间模式用跨日扁平卡表)+ Enter 开卡、t 回今日、1/2 热力口径、? 帮助。

## 视图校准基线

- 视觉基准 = `docs/design/daily-work-footprint/v2-prototype.html`(v2 三栏骨架);实现偏差(如热力条 14×3px 色条、seg 选中白底浮起、chip 描边胶囊)以原型为准,后续改动先对照原型再动代码。
- 真实目检配方见 memory:1421 dev server + Tauri IPC 桩(footprint 桩需 rollup 月文件/features/`:3` 会话 jsonl/dailyPaths 路径的 article 文件;journal 路径必须按 `dailyPaths()` 的 `configDir/daily/` 摆放)。
