# 工作台细节打磨:全量代码评审(打磨点清单)

- 日期:2026-10-12
- 评审对象:src/plugins/workbench/(约 16.5k 行,base 版之后全量)
- 方法:四片并行只读评审(主视图/任务闭环/docgen/journal+store)+ 高危条目逐条人工核实;不含已修批次(泳道看板/CodeMirror/示例清理/终结会话 resume 等 2026-10-11 前落地项)
- 口径:只收 UI 状态缺口与交互闭环死角,不收新功能建议;每条带 file:line

## 高危(5 条,全部人工核实坐实)

| # | 位置 | 问题 | 修法 |
|---|---|---|---|
| H1 | types.ts:192 normalizeProject | sessions 归一化只回 ref/kind/profileId/title/createdAt 五字段,`TaskSessionLink.cliSessionId` 从不读入。loadWorkbench 每次装载走 normalize,运行期写入的磁盘身份重启即剥掉,且后续任意 mutate 把剥净数据写回 index.json——「凭磁盘身份 resume」特性被装载序列化整体打穿,降级到标题±5min 猜测 | 归一化补 `cliSessionId: str(link.cliSessionId)` 一行,旧数据天然兼容 |
| H2 | WorkbenchTab.tsx:138 | 项目表单 `onSubmit={(v) => actions.submitForm(v).finally(() => setFormOpen(false))}`——submitForm 失败重抛,`.finally` 失败分支也关窗:整表丢稿,ProjectFormModal 自带 catch(错误留窗)落在已卸载组件上被击穿。ProjectDetail.tsx:117 同弹窗用法是对的(失败留场显示 wb-form-error) | 删父级 `.finally` 关窗,失败让 modal 留场 |
| H3 | docgen/queue.ts:162 | `cancelDocGenTask` 排队分支只 patch task 为 err,不经 failEntry/terminateEntry 收割 entry;entry.status 永卡 "gen"(gen 态唯一出口在 run 路径/pump 兜底/重启 run 改判,三条全绕开)。Reader 的终止钮 `if (task) cancelDocGenTask(task.id)` 恒空转却无条件 toast「已终止:收割会话并回落」;fail 态才有的重试入口到不了,重启不自愈 | 排队取消对称调 failEntry;终止/取消按返回值如实 toast |
| H4 | docgen/DocGenDialog.tsx:82 | submit 走 `void createEntry(...)` 异步写盘,DialogShell 未传 locked、DialogActions 未传 submitting(kernel DialogShell.tsx:10 契约:提交中禁关+主钮切 Spinner;ProjectFormModal.tsx:85 是正确用法)。写盘期间 Esc/背板关窗条目照建;连点产出两条同维度条目,第二条任务被去重后无任务永卡 gen | submit 置 busy,locked+submitting 接既有契约 |
| H5 | DrawerDocsTab.tsx:94 | 编辑器「返回列表」`onClick={() => { setOpenDocId(null); setDirty(false); }}` 一键无声弃稿,头部正渲染「未保存」脏标记;TaskDetailView.tsx:134 / TaskFormView.tsx:67 同款。journal NoteEditor.tsx:146 脏稿 Esc 先确认是既有正确先例 | dirty 时返回走 WbConfirm「未保存的修改将丢失」 |

## 中危——交互闭环

| # | 位置 | 问题 |
|---|---|---|
| M1 | NoteEditor.tsx:148(结合 ArticleTab.tsx:254/223) | 脏稿守护只覆盖 Esc;tab `{ refresh: true }` 重挂、切日、切月、关 tab 均静默丢稿,误触最高频路径(再点同一天)恰无守护。脏态需提升到 ArticleTab 层 |
| M2 | Followups.tsx:51、drawerTabs.tsx:96 | 任务/进展删除单击即删无确认,× 紧贴完成任务勾选框高危区;store.ts:193 deleteTask 不清理任务附件实体,docs/project-*/ 留孤儿文件(清空路径 removeProjectArtifacts 会删,单删不会) |
| M3 | drawerTabs.tsx:118 | 进展提交 `runIpc(addUpdate(...)); setText("")` 同步清空,写盘失败输入内容不可恢复;违反本插件自订「成功才清 dirty」契约(TaskDetailView.tsx:65 是正确实现) |
| M4 | TaskFormView.tsx:92、drawerTabs.tsx:130 | Enter 提交无 `!e.nativeEvent.isComposing` 守卫,中文选词回车直接建任务/发记录;kernel/shortcuts.ts:15 与 approval-inbox 已有全库契约 |
| M5 | journalStore.ts:123 | saveNote 快照-落盘-提交无串行链(meta 写链有 metaWrites,notes 没有),同月两日快速保存后提交者读旧 snap,内存与磁盘整月文件互相丢更新 |
| M6 | journalStore.ts:112 | persistMeta 失败 `.catch(() => undefined)` 整体吞;GenSettings.save 无条件 onClose——定时/引擎配置落盘失败零感知,重启静默回旧值 |
| M7 | genSession.ts:165(结合 journalSchedule.ts:33) | 定时族任务三处早退失败(!ws/!profile、TUI !sent、oneshot !sent)只 finishTask 不 addBead;幂等闸只认 beads → 交付持续失败时每个 15min tick 重入队,最坏 ~96 次真实 spawn/天 |
| M8 | TaskDetailView.tsx:124 | 开新会话成功后 `linkTaskSession(...).catch(() => undefined)`,关联写库失败静默——会话开了但任务上看不到,路径半途无提示 |
| M9 | TaskDetailView.tsx:105、ProjectDetail.tsx:198 | useProjectSessions 扫描期返回 null 与 listSessions 失败(catch 成 [])同报「暂无可用引擎会话,先去侧栏开过一次」,误导;应区分扫描中/失败/真空态 |
| M10 | wbTabs.ts:30、ProjectTab.tsx:16 | openProjectTab 不传 `{ refresh: true }`,kernel tabs 对已存在 tab 保留首次 payload → docgen/jump.ts:32 溯源深链 focusTab「进展」被静默丢弃;ProjectTab 也只 mount 读一次 initialTab |
| M11 | sessionOpen.ts:23 | 死链找回 title 判据拿任务标题对会话标题(TaskDetailView.tsx:124 存的是 task.title)几乎必不命中,实际只剩 ±5min 邻近兜底在赌,同刻同目录另一任务会话可能被错 resume 且无确认 |
| M12 | ArticleTab.tsx:207 | 正文会话链接 live 分支只 requestSessionReveal(定位侧栏行)不发 sessionViewRequested(亮幕布);同函数 disk 分支与 UnfinishedPanel/GenSessionBar 全发——编辑器最大化时点了只有侧栏高亮,体感「没反应」 |
| M13 | docgen/DocGenFoot.tsx:28 | copyMd/saveAsDoc/exportMd/sendToComposer/askHere 五处 `if (!md) return` 无 disabled 无 toast——版本文件缺失时整排按钮点了没反应 |
| M14 | docgen/DocGenReader.tsx:95 | retryWith/regen 的 createEntry `.then` 无 rejection 参数,索引超 496KB 闸或写盘失败时重试/重新生成毫无反应(同文件 DocGenDialog submit 有 catch 先例) |
| M15 | docgen/DocGenReader.tsx:63 | 版本正文 loadVersionMd 失败(null)什么都不发生,阅读区永久空白,无加载占位/错误卡;转任务与对比随之全不可用 |
| M16 | docgen/docgen.css:33 | dg-row-stop 仅 hover 显形(display:none→block),离开 Tab 序,生成行键盘不可终止;兄弟组件均有 :focus-within 先例 |
| M17 | docgen/docgen.css:137 | `.dg-srcrow input:disabled + ::first-line` 的 `+` 只匹配元素兄弟,实际 input 后是裸文本节点永不命中;禁用行全对比度且 cursor 仍手型 |
| M18 | docgen/DocGenDialog.tsx:95 | 弹窗内排程 updateSchedule 失败 `.catch(() => undefined)`,内存态照翻 on 显示运行中,重启后排程丢、全程无反馈 |

## 中危——UI 与 i18n

| # | 位置 | 问题 |
|---|---|---|
| M19 | screens/cards.tsx:56、ListScreen.tsx:50、insights.ts:145 | formatRemaining(「已逾期 N 天/还剩 N 天」组合串)、risk.label、headline 整句中文模板渲染端全绕过 t(),en/ja 界面四屏残留中文 |
| M20 | journal/UnfinishedPanel.tsx:105、journal/locales/ja.ts:129、journal/genSession.ts:166 | ① `t("空闲")` en/ja 词典双缺;② ja 译文混「错过则下次启动补跑;」中文残段;③ 生成链错误文案(无本地工作区/提示词未能送达/生成超时等)裸中文经 meta.lastError 直出面板,docgen 姊妹域同类文案已词条化 |
| M21 | workbench.css:52、workbench-dialogs.css:104-106 | `.wb-btn-danger` 与 `.wb-imgview p` 硬编码 #fff 绕 token;imgview 背板是 `color-mix(var(--tmd-fg) 55%)`,深色主题下背板变浅、白字题注对比度崩 |
| M22 | docgen/docgen.css:29-31 | `dg-chip-sched` 与 `dg-chip-ok` 同为 `--tmd-ok` + `--tmd-accent-soft`,排程态与成功态视觉不可辨;gen 态 warn 配 accent-soft 底也错位 |

## 低危

| # | 位置 | 问题 |
|---|---|---|
| L1 | store.ts:155 | createTask/updateProject/updateTask 目标 projectId 无命中时照常写盘 resolve,表单报假「已保存/已添加」(编辑中被删盘+从磁盘同步后必现) |
| L2 | WorkbenchTab.tsx:207 | refreshNow 的 reloadWorkbench 无 rejection 分支,reject 后 refreshing 永久 true,「从磁盘同步」永禁用 |
| L3 | ProjectFormModal.tsx:67 | 仅校验名称非空;startedOn > dueDate 倒挂入库(概要页立即显示「已逾期」)、重名不提示 |
| L4 | TaskDetailView.tsx:100、ProjectDetail.tsx:196 | 开新会话无在途禁用,连点重复建会话;同页「从磁盘同步」已有 disabled={refreshing} 先例 |
| L5 | ProjectTab.tsx:18 | 项目详情 toast 无自动清除,与主页 2600ms 口径不一致,「已保存」永久钉在页底 |
| L6 | OverlayActions.tsx:25 | 「示例数据」下拉 role=menu 却无 Escape 关闭、无方向键导航;kernel DialogShell useEscClose 是全库惯例 |
| L7 | WorkbenchTab.tsx:126 | 加载/写盘错误横幅无关闭无重试,成功写盘前常驻 |
| L8 | screens/TaskBoard.tsx:111 | 「进行/完成」推进无在途防护,快照回写间隙二连点把任务静默推成 done |
| L9 | screens/TaskBoard.tsx:76 | 泳道折叠态组件局部 state,切页签即丢;WbScreen.tsx:21 注释 journal 视图态已 localStorage 自持,口径不一 |
| L10 | screens/ListScreen.tsx:13 | 三屏空态文案「当前筛选下没有项目」但页面无筛选器,失真;空态引导动作比 Overview 少(无关联工作区入口) |
| L11 | workbench.css:79、Overview.tsx:85 | 圆环/SVG 文本硬编码 px 字号,不随全局界面字号缩放(内核 12-20 档 rem 体系) |
| L12 | store.ts:100 | createProject/generateSamples 的 docs 写盘在 try 外,index 写失败不回收已落盘文档实体,留孤儿且重试换新 id 重复写(attachDocFile 有 removeDocFile 回收先例) |
| L13 | docgen/DocGenFoot.tsx:74 | askHere 发送失败分支不 removeSession,侧栏留孤儿空会话 |
| L14 | docgen/DocGenReader.tsx:55 | 对比视图选 v1(首版无上一版)误报「版本不可解析」 |
| L15 | journal/ArticleTab.tsx:70 | GenSessionBar 判活用 host.getSessions() 非订阅面,会话退出后面板长期显示「打开会话(可干涉)」,点击无去向 |
| L16 | journal/YearView.tsx:55 | 年视图月份快照未就绪时,有会话的日全按黄「待提取」渲染,加载完跳色误导;一次并发 12 月 ≈372 个 fs IPC 放大窗口 |
| L17 | journal/NoteEditor.tsx:73 | saveErr/pasteErr 置位后成功路径不清,错误提示常驻到进编辑态,用户无法判断当前存没存上 |
| L18 | journal/GenSettings.tsx:114 | 定时输入全角「:」/全角数字静默丢弃,失焦回退旧值也无提示 |
| L19 | journal/daySessions.ts:165 | 单引擎 listSessions 失败吞成 [],月格显示「无会话」且调度层补跑/增量据此静默跳过,无任何状态可查 |
| L20 | screens/TimelineScreen.tsx:30 | 甘特条按钮无可达名称,起止日期只存 title(hover 专属),读屏/键盘用户拿不到 |
| L21 | DocGenCenter.tsx:181 | 列表行终止钮用裸「✕」字符,同插件删除/关闭一律 phosphor `<X size={11}/>` |
| L22 | screens/ListScreen.tsx:39 等 | 「未指定」「其他项目」兜底字面量散布 5+ 渲染点(含图表 tooltip),未走 t() |

## 建议推进顺序

1. H1 一行修,先落(数据级身份丢失,越拖用户数据越坏);
2. docgen 批:H3+H4+M13-M18 同域顺手清;
3. 丢稿族批:H2+H5+M1-M4(统一 WbConfirm 脏态守护与「成功才清」口径);
4. journal 持久化批:M5-M7+L16-L19;
5. i18n 批:M19-M22+L22;
6. 低危按随手清。

每批落地照例:typecheck+test+arch+file-size+build,UI 行为改动 tauri:dev 目检,收口 react-doctor 100。

## 处置(2026-10-12 当日修复全落地)

49 条全部落修,另含集成批增补:i18n 横切路交付的同族字面量 7 处(ProjectDetail/TimelineScreen/TaskBoard 空态与风险文案、charts 环形图、calendarTimeline)、deleteProject 附件实体同口径回收、M9 失败态接线(useProjectSessions 改 `{rows, failed, reload}`,三调用方 + 失败 pill/重试)、sessionOpen.test.ts 死链找回用例按新契约改写(邻近唯一命中/歧义不赌)。

落实要点对照:H1 归一化补 cliSessionId(桩实测写穿后磁盘身份保留);H2 父级 `.finally` 关窗移除,失败留窗显示 wb-form-error(桩实测);H3 排队取消对称 failEntry + 终止/取消按返回值如实 toast(queue.test 断言);H4 submit 置 busy + DialogShell locked/submitting(桩实测:busy 期 Esc 无效,失败留窗报错原文,成功入队关窗);H5 DrawerDocsTab 脏稿返回 WbConfirm(桩实测:取消留编辑器、丢弃回列表)。journal 批:notes 落盘照 metaWrites 加串行链、persistMeta 失败上浮不关窗、定时族早退失败补落珠(幂等闸生效)、genSession 错误文案词条化、脏态提升 ArticleTab + keepAlive + 唯一丢稿路径 WbConfirm 闸。i18n 批:formatRemaining/risk/headline 全部 t() 化,ja 中文残段清理,「空闲」补键;cards.tsx 纯函数搬 insights.ts(react-doctor only-export-components)。收口前 react-doctor 修至本地扫描零违规:NoteEditor 脏态上浮改变更点直报、ReaderBody 两层开关拆分 + ReaderChrome.tsx 拆文件、MiniMonth 数据构建拆 yearCells.ts。

验证:typecheck / test 3901 用例 / arch-boundary / file-size / build 全绿;react-doctor 修复过程两次实跑 100/100(收口时分数 API 抖动,本地分析 1756 文件零违规);1421 桩目检实走 H1 写穿、H2 失败留窗/成功关窗、H4 锁窗、H5 脏稿确认、看板推进、i18n headline。

### 遗留(不阻塞本批)

1. **内核 dirty tab 关闭确认契约**:journal 便签脏稿的「关页签/⌘W」路径仍在域外(EditorTabStrip closeTab / TabContextMenu 注释明言 dirty tab 不加确认 / shell.closeTab)。keepAlive 只保切换不保关闭;需要 kernel tabs 提供 beforeClose 闸由编辑侧注册,涉全插件页签语义,单列后续批。
2. OverlayActions 方向键导航(低危;Escape 关闭已补)。
3. M9 失败 pill 未能桩驱动:各 CLI 扫描器内部吞错,listSessions 在桩环境永不 reject;渲染分支已接 + typecheck 覆盖,待真实磁盘错误场景目检。

## 提交后对抗评审(2026-10-12 第二轮,回归面)

四提交落地后换角度复审(不再找打磨点,专审修复本身),7 条发现全修:

| # | 位置 | 发现 | 处置 |
|---|---|---|---|
| R1(high) | journal/genSession.ts:170 | 扫描部分失败「即中止」没中止:failGen 后缺 return,残缺清单照常生成并盖 summarizedAt 水位(L19 注释声称要防的危害原样发生) | 补 return 真中止 |
| R2(med) | journal/genSession.ts:230 | 预结算段抛错(createSession/prompt 落盘)绕过 failGen:定时族无珠照旧 15min 重入队、当日无错可显 | runner 装配处兜 .catch → failGen(新键「生成会话异常」en/ja) |
| R3(med) | journal/ArticleTab.tsx:241 | 放行闸确认弃稿重挂后 ArticleTab 脏态不归零:幻影脏圆点 + 闸判据失真反复弹确认 | 重入信号抽 useArticleEditSignal(journalTabs.ts),重挂同步 setDirty(false) |
| R4(med) | drawerTabs.tsx:132 | 「成功才清」改造后进展提交无在途守卫,写盘窗内连点重复入账(旧版同步清空恰好挡住,属改造引入的回归面) | 补 pending 守卫 + 按钮禁用 |
| R5(med) | journal/locales 170-172 | journal 三条错误词条与 docgen 词典同键异值,注册序靠后被覆盖成死键(撞 7f71b2e6 撞车零容忍纪律) | journal 侧五处译文对齐 docgen 同值 |
| R6(low) | ProjectTab.tsx:40 | focusSeq 计数器:同值 focusTab 重复深链也整棵重挂 ProjectDetail,抽屉未保存输入被静默清掉 | 仅 focusTab 值变化才 bump key |
| R7(low) | journal/NoteEditor.tsx:127 | Esc 确认弹层「丢弃」走 cancel 后 askDiscard 残留 true,重进编辑态弹幻影弃稿确认 | cancel() 补 setAskDiscard(false) |

复审后门禁:typecheck(本批面)/ test 3901 / file-size / react-doctor 100 零违规复验;JournalTab/queue 既有断言全绿。
