# 工作台并入每日日志:分阶段评审记录

- 日期:2026-10-11
- 评审对象:工作区未提交变更(daily-journal → workbench/journal 合并);spec 见 docs/superpowers/specs/2026-10-11-workbench-journal-merge-design.md
- 范围排除:src/plugins/workbench/ProjectDetail.tsx、TaskDetailDialog.tsx、sessionOpen.ts、sessionOpen.test.ts(并行会话在途改动,非本批)

## P1 阶段(合并与入口统一)—— reviewer 结论:OK with notes

五维实证(A 行为回归 / B 装配正确性 / C 架构边界 / D 契约完整性 / E 测试充分性),前四维零发现:

- A:全仓 grep 活代码零残留(daily-journal/JournalPanel/openJournalTab/dj-panel);mobile/settings/shortcuts/welcome 零命中;css 死块已清;词典死键三枚(今/每日工作日志/关联)en/ja 双侧清零。
- B:宿主真消费 activate 返回值(pluginLifecycle.ts activateWaves/activateLate pushCleanup);attachJournal teardown 覆盖 journal 侧全部四类运行期副作用(定时器/增量去抖/事件订阅/生成体);booted 幂等与 keepAlive 语义不因搬家改变。
- C:unfinished.ts → session-board 常量 import 与 architecture/02「依赖铁律」app 树例外条款逐条吻合(条款先例本就点名此依赖);WbScreen 引 journal 为插件内 import,零新增跨插件耦合。
- D:WbTab 三处同步零分支;i18n 经模块顶 import 先于渲染注册;localStorage 旧值(y/m/脏值)全兼容。
- E:真行为锁 = FlowView 实渲染月条格数 + 日卡;两条 P2 断言空转已修(见下)。

### P2 发现与处置(全修)

| # | 发现 | 处置 |
|---|---|---|
| P2-1 | FlowView.tsx 头注仍指已删宿主 JournalPanel;同族名漂移注释 7 处(kernel/DialogConfirm、cliProfile、fsDirs、transcriptDigest、cli-shared/engineGlyphMap、engineGlyphs、marks/evidenceScope) | 全部改注(纯注释,零代码行为) |
| P2-2 | JournalTab.test 两条断言空转:①选中态正则左支恒真(右支兜底);②「dj-month」子串被工具栏 dj-month-title 常驻命中,年/轴视图也会过 | ①改 /aria-selected="true"[^>]*>轴视图/ + 年/月 false 反证;②改 'class="dj-month"'(MonthView 根)+ not.toContain("dj-flow-root") 反证 |

遗留说明:被删 JournalPanel.test 的 fold store 折叠态与 openArticleTab 深链断言未在 JournalTab.test 复刻 —— 前者是 FlowView 内部态(静态渲染测不了交互折叠),后者已由 MonthView.test 深链路径覆盖,不补。

P1 门禁:typecheck 0 错 / 全量 3852 测试 / arch-boundary / file-size 全绿;词典死键审计(修正版脚本)双域零新增死键。


## P2 阶段(关联层)—— reviewer 结论:OK with notes(1×P1 + 5×P2)

正确性维度核过:匹配语义与 TaskSessionLink 契约逐字段一致(host 链 ref=meta.id ↔ 活行 id;disk 链 ref=cliSessionId+profileId ↔ 磁盘行);React 面 hooks 依赖完整、StrictMode 安全、先 null 后 chip 是正确取舍;性能面 memo 不被击穿、排序不污染源数组;词典/行数绿。

| # | 发现 | 处置 |
|---|---|---|
| P1 | dayTaskLinks disk 链在会话转活后假阴性(活行 id 已换 app 会话 id,磁盘身份只在 r.disk 凭证)→ 任务 chip 恰在进行中消失 | 已修:disk 分支活行按 `r.disk?.id === link.ref` 命中(与 pendingAutoDoing「host/disk 通吃」先例对齐);补测试「disk 链 × 活行 r.disk 凭证」 |
| P2 | 死类名 .dj-daylinks / .dj-dl-task 无 CSS 规则 | .dj-daylinks 从 JSX 删;.dj-dl-task 补 dashed 边框区分样式 |
| P2 | 自造 token --tmd-radius-full(全仓无定义) | 改字面量 999px(仓内先例 intent-canvas/session-viewer) |
| P2 | cwd 尾斜杠永不命中(自由文本输入,与 resolveWorkspaceId 行为相悖) | 已修:normRoot 两侧去尾斜杠后精确匹配;补测试 |
| P2 | 同 cwd 双项目行双计未文档化 | 锁定为既定语义(各 chip 各归其项目),补测试钉死 |
| P2(test) | 组间排序/多 ws 同根/空 rows/活行凭证等 5 处缺口 | 全部补齐(dayLinks.test 5→11 用例) |

修复后复跑:dayLinks 域 11 用例绿 + typecheck 0 错(评审建议项全数落地)。

## P3 阶段(生成项目感知)—— reviewer 结论:OK with notes(6×P2,零阻塞)

主线契约全实证通过:prompt 无组零差异(子串级)、digest 无组原样、三条降级路径(store 拒/快照空/cwd 不匹配)全通、取消竞态有 20 分硬顶兑底、../store 静态 import 无环、端到端用例走真 dayProjectLinks/buildDayDigest 非回声。

| # | 发现 | 处置 |
|---|---|---|
| P2-1 | 同 cwd 双项目(双计语义)致同一会话摘录重复收录、coveredIds 重复 | 已修:组循环补跨组去重(同会话归首组);补双组共享 id 用例 |
| P2-2 | 预算截断可致组头静默丢失(或与实收错位) | 已修:组头延绑 —— 预算循环里随首条实收才发,首条被截留待后续成员,不落孤儿头 |
| P2-3 | store 抛错降级路径零测试覆盖 | 已修:wb.load 注入 reject 用例,断言零分组 + 任务走完 |
| P2-4 | 「项目分组注入」用例缺 bootGenSession,依赖前例残留 runner | 已修:用例开头补 bootGenSession(makeBus()),独立可跑 |
| P2-5 | 增量×分组组合零覆盖,分组指令与「既有节逐字保留」语义相抵 | 已修:groupRule 增量模式收窄为「新节分节优先按项目组织(既有节逐字保留,不重排进项目壳)」+ 组合用例 |
| P2-6 | oneshot 拆分文件残留主文件旧头注释 | 已删 |

修复后复跑:journal 域 119 用例绿;全量门禁(见收口段)。

## 收口验证(2026-10-11)

- 全门禁:typecheck 0 错 / 全量 3871 测试(494 文件)/ arch-boundary / file-size / react-doctor 100 / pnpm build 过。
- 1421 桩目检(桩:1 工作区 / claude+omp 当日会话 / 1 项目绑定 cwd / 1 任务挂磁盘链):左 rail「工作台」→ 中央 tab 页签含「日志」;年/月/轴三视图 seg(月缺省、轴持久化恢复);轴视图月条 31 格 + 当日 1 卡;月格点有记录日 → 文章 tab(标题/当日会话 3 行);「当日关联 1 个项目 · 1 个任务」chips(甲项目·3 会话 / 甲任务);点项目 chip → 项目详情中央 tab 打开。截图管线在 headless 桩超时,视觉留真窗口目检。
- 文档对码:FEATURES.md 能力 Hub 段补合并条目;architecture 01(44 注册 = engine 10 / feature 30 / core 3 / local 1;右缘 rail 去 daily-journal 面板)+ 02(PLUGINS 图 P_DJ 节改 workbench·journal 子域;依赖铁律先例名更新;Note2 右栏 tab 清单注退役)。
- 真机 tauri:dev 目检留大仙(轴视图宽幅视觉/生成会话真链路)。
