# 调研:每日工作日志(daily-journal)并入工作台(workbench)可行性

- 日期:2026-10-11
- 状态:已完成(结论:可行;未开发,设计待启动)
- 需求来源:大仙——每日工作日志应与工作台合并优化,嵌入工作台,并能关联工作台的任务、项目;本篇只做可行性验证,不做开发。

## 结论

三条诉求逐一验证,全部可行,且是「干净合并」而非勉强拼接:

1. **插件合并可行**:daily-journal 无任何外部消费者,合并面 = `allPlugins` 一行 import + 一行注册 + tab 契约测试一行;零 kernel / Rust 改动,R1/R3/R4 不涉。
2. **嵌入工作台可行**:工作台页签是查表分发(`WbTab` 联合 + `SCREENS` 记录),新增「日志」页签是纯插件内改动;文章 tab 与右栏轴视图面板可原样保留为深链与幕布外增强。
3. **任务/项目关联可行**:数据桥已存在,不需要新增任何跨模块契约——
   - 日 ↔ 项目:`DaySessionRow.wsId`(daySessions.ts)↔ Workspace.root ↔ `Project.cwd`(types.ts);
   - 日 ↔ 任务:`TaskSessionLink`(disk/host)↔ 行身份 `id + profileId`;任务时间戳本就可归日;
   - 生成器项目感知:prompt 组装与摘录构建都在插件内,按 cwd→项目分组注入即可。

前置条件只有一条:**workbench 尚未提交**(2026-10-10 八轮迭代 + 2026-10-11 任务生命周期定稿,in-flight),合并动作须等其收口提交后单独立项,不叠加并行改动。

## 现状盘点(代码事实)

### daily-journal(每日工作日志)

- 注册面(`index.tsx`):`registerFilePanel`(右栏轴视图面板 + rail 入口,centerTab 联动)+ 两个中央 tab kind:`daily-journal`(年/月日历主视图)、`daily-article`(每日文章/便签)。
- 数据盘:`~/.tmd-cli/daily/`——`article/YYYY-MM-DD.md`(一天一篇,生成会话直写)、`notes/YYYY-MM.json`(便签)、`meta.json`(beads 账本/生成状态/任务史/配置)、`digest/YYYY-MM-DD.md`(当日会话摘录)、`holidays/YYYY.json`、`assets/`。
- 生成链:`journalSchedule`(定时/补跑/增量三源入队)→ `taskQueue`(串行队列)→ `genSession.runGeneration` → `collectSessionRowsBatched`(全工作区×全家族扫会话,按「会话开始日」归日)→ `sessionDigest`(经各 CLI 插件声明的 `readSessionTranscript` 适配器提摘录)→ `promptGen`(清单+摘录拼 prompt)→ 无头 oneshot 或后台 TUI 会话 → 文章落盘 → turnSettled/fileEditDetected/落盘轮询三路结算。
- 体量:约 50 个文件;非测试代码最大 274 行(genSession.ts),全部满足 300 行铁则;自带 en/ja 词典与独立 css。
- 关键行结构:`DaySessionRow { profileId, title, id?, startedAt, modifiedAt, live, wsName, wsId?, disk? }`——**每条会话行已带工作区身份(wsId)**,按开始日聚合(`groupByDay`),摘录水位 `summarizedAt` 支撑增量语义。

### workbench(工作台)

- 注册面(`index.tsx`):中央 tab `wb.console`(本页,keepAlive)+ `wb.project`(项目详情,keepAlive)+ 左 rail 第一位 sidebarAction。
- 页签:`overview / board(任务看板) / list(项目列表) / calendar(日历) / timeline(时间线) / followups(待跟进)`,由 `wbTabs.ts` 的 `WB_TAB_ITEMS` 与 `WbScreen.tsx` 的 `SCREENS: Record<WbTab, Component>` 查表分发——**当前没有「日志」页签**,两插件此前零耦合(全仓 grep 实证:唯一交点是 `plugins/index.ts` 相邻两行注册)。
- 数据盘:`~/.tmd-cli/workbench/`——`index.json`(轻索引)+ `project-<id>.json`(全量)+ `docs/project-<id>/` + `AI-TASKS.md`(AI 回写约定)。
- 实体:`Project { module, status, owner, progress, tags, cwd?, docs[], updates[], tasks[] }`;`ProjectTask` 含 `description / attachments[] / sessions: TaskSessionLink[]`;`TaskSessionLink { ref, kind: host|disk, profileId, title }`(纯关联,不动会话生命周期)。
- 既有会话桥:`Project.cwd` 绑定工作区根后,`useProjectSessions(cwd)` 走 `profile.listSessions(cwd)` 公共面看最近会话;`views.resolveWorkspaceId(root→wsId,精确命中优先、子目录取最深前缀)` 已存在(与 daily-journal 同口径)——**root↔wsId 双向映射的另一半现成**。

## 可行性论证

### 1. 插件合并(架构面)

- 两插件同为 feature 类,合并 = 目录迁移(`src/plugins/daily-journal/` → `src/plugins/workbench/journal/` 一类的子目录)+ `allPlugins` 删 daily-journal 注册 + `registerFilePanel/registerTabContent` 改由 workbench.activate 登记。kernel、Rust、其余插件零改动。
- 外部引用面 grep 实证仅两处:`src/plugins/index.ts`(import + 数组行)、`src/plugins/tabContent.contract.test.ts`(kind 清单含 `daily-journal`/`daily-article`,合并后契约不变,测试表不用改)。
- 反方案否决记录:
  - *保持双插件、workbench 跨插件 import journal 模块*:违反插件纪律(贡献面一律经 activate 注册面;插件间直接 import 破坏独立性),且两插件无「≥2 cli-* 消费」的 cli-shared 准入资格(journal 不是 CLI 格式知识);
  - *把 journal 下沉 kernel*:「单插件语义不入 kernel」铁律直接禁止。
  - 合成一插件是唯一干净路径,且正合「合并优化」本意。

### 2. 嵌入工作台(UI 面)

- `WbScreen` 是零分支查表:新增 `"journal"` 页签 = `WbTab` 联合加一项 + `WB_TAB_ITEMS` 加一行 + `SCREENS` 加一条。JournalTab/MonthView 的自足 props 包一层 JournalScreen 适配 `WbScreenProps(projects, today, onOpen)` 即可;`wb.console` 已 keepAlive,页签切换态不丢。
- 文章 tab(`daily-article` kind)与右栏轴视图面板原样保留:工作台日志页签点某日 → `openArticleTab` 深链出文章/便签编辑;轴面板是幕布外增强,继续由合并后插件登记。原「每日工作日志」主视图 tab(`daily-journal` kind)可保留兼容既有入口,亦可随合并退役(设计阶段定)。
- 词典与 css:两插件词典都是 import 即注册,目录合并后天然归一;css 改由 workbench 入口引入。

### 3. 任务/项目关联(数据面,核心)

全部为派生计算,不新增落盘格式、不动 kernel、不动 CLI 适配器:

| 关联 | 映射链 | 证据 |
|---|---|---|
| 某日 ↔ 项目 | `DaySessionRow.wsId` → `getWorkspaces()` → `ws.root === Project.cwd`(或 resolveWorkspaceId 同款前缀匹配) | daySessions.ts(行带 wsId)、types.ts:96(cwd 注释「绑定后任务可在此 cwd 开会话、详情可见最近会话」) |
| 某日 ↔ 任务(硬) | `TaskSessionLink{ref,kind:disk}` ↔ 行 `{id, profileId}` 相等即「该任务这天动过会话」;host 型按磁盘身份兜底(workbench 三轮已做死链兜底先例) | types.ts TaskSessionLink/ProjectTask.sessions |
| 某日 ↔ 任务(日程) | `startedOn / dueDate / doneAt / updatedAt` 按本地日归桶(workbench calendarTimeline 已有同口径日期工具) | types.ts、calendarTimeline.ts |
| 某日 ↔ 项目(动态) | `ProjectUpdate.at`(ISO)归日 | types.ts ProjectUpdate |
| 文章 ↔ 任务(松) | 文章 md 的 `## 未完事项` 节 articleParse 已解析,可对任务标题做提及式对齐(仅展示层建议,不做写回) | 2026-09-29 spec 文章契约、articleParse.ts |

生成器的项目感知升级(把「一天做了什么」升级为「各项目做了什么」):

- `runGeneration` 已持有全量 `DaySessionRow[]`,按上表第一行映射分组即可得「日 × 项目」会话簇;`buildGenPrompt` / `buildDayDigest` 都在插件内,prompt 注入项目名、当日活跃任务、到期任务是纯文本组织变化。
- 摘录文件保持按日单文件(`digest/YYYY-MM-DD.md`),内部按项目分节,零契约变更;生成会话(真实 CLI agent)写文章的既有结算/增量/幂等机制全部不受影响。
- 收益是双的:一次 `collectSessionRowsBatched`(带 TTL 缓存)的结果可同时喂日历热力与日×项目关联,合并后反而比两套扫描省。

若将来需要**持久化**的日↔任务硬关联(而非派生),`meta.json` 的 `DayMeta` 是开放形状,加可选字段(如 `taskRefs[]`)即可,additive 向后兼容;但派生优先——单一事实源,无同步问题。

## 风险与时机

1. **workbench 未提交**(八轮 + 任务生命周期定稿 in-flight):合并须等其收口提交后单独立项。这是唯一硬前置。
2. **数据不迁移**:`~/.tmd-cli/daily/` 路径原样保留,只换代码归属;历史文章/便签/账本/摘录/节假日缓存全兼容,零用户可见迁移。
3. **信息架构决策点**(留设计阶段,非可行性障碍):
   - rail 入口收敛:工作台已是 rail 第一位,daily-journal 的右栏面板入口去留;
   - 工作台「日历」页签(项目日程)与「日志」页签(日活动热力+文章)并存还是合流;
   - 生成设置(GenSettings 弹层)与配置持久化位置不变(meta.json),入口挂进工作台何处;
   - 原 `daily-journal` 主视图中央 tab 保留还是退役(有 rail/centerTab 联动在,建议保留深链)。
4. **体量**:合并后单插件约 9k 行 TS/TSX(两插件之和),文件数多但单文件最大 299 行,300 行铁则无风险;目录按 `workbench/journal/` 子域组织即可。
5. **量级估计**:纯迁移 + 日志页签接入约一天内;日×项目/任务关联视图与项目感知生成是增量设计题,随交互设计定规格。

## 与既有规划的关系

- 0.3.2「日常工作流整合」W3 已把 journal 纳入工作流(文章会话引用、JournalPanel 未完聚合),本合并方向与该规划同向,不冲突;
- workbench spec 的任务生命周期定稿(2026-10-11)后,任务侧时间戳(doneAt/startedOn)语义稳定,日↔任务归桶有了可信锚点。

## 验证(本调研)

- 全仓 grep 实证:daily-journal 零外部消费者(仅 allPlugins 注册 + tab 契约测试 + kernel DialogConfirm 注释提及);
- 两插件关键文件通读:index/journalTabs/journalFiles/journalStore/journalSchedule/daySessions/genSession/promptGen(spec)与 workbench index/wbTabs/WbScreen/types/useProjectSessions/store 相关面;
- 双方设计 spec(2026-09-29 daily-journal 四篇、2026-10-10 workbench 八轮)核对:存储、生成契约、注册面、方案取舍无互相抵触条款。
