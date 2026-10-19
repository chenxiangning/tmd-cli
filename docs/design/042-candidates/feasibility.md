# 0.4.0 批次入选五项推演定稿(带 path:line 锚点)

五路并行深度推演(2026-10-18,实读当前工作树含 0.4.0 全部落地)。每项:现状核实→端到端→契约→边界→裁决(含被否方案)→设置→验证→实现步序。落选三节(#2/#5/#8)已删,理由见 README 与 brainstorm 文档。

## 1. 终端文件路径可点击(S)

**现状核实**:`src/kernel/terminalLinks.ts:16-27` 已有 `TerminalLinkProvider { id, find(lineText): {start,end}[], open(hit,lineText) }`(0 基字符下标,cell 换算 kernel 做);`:36-47` 注册表 upsert+退订;`:63-103` 聚合单 ILinkProvider、空行快返、find 抛错逐 provider 跳过。`TerminalView.tsx:145,147` WebLinksAddon 先注册、聚合体后注册(注册序即优先级)。**「开文件+滚到行」原语现成**:`src/kernel/fileTabs.ts:25-46` `openFileAtLine(path,line)`(normalizePath 消费端 `FileTabContent.tsx:74-78` CodeMirror 定位)。完整先例:`src/plugins/marks/terminalLink.ts:8-38`(backlink provider,`openFileAtLine + requestReveal`;ABS_PATH_RE :13 已有盘符/UNC 判定)。

**端到端**:hover→xterm provideLinks 逐可视行→聚合体 `translateToString(true)`→遍历 providers(marks→新 path provider)→点击→`provider.open`→活动工作区 root 拼绝对路径→`openFileAtLine`→files tab refresh→CodeMirror 滚动+高亮。0.4.0 冻结快照回放同一 term 实例,链接天然生效,零额外交互。

**契约**:新 provider 落 `src/plugins/files/terminalPathLinks.ts`(≤60 行,PATH_RE+`filePathLinkProvider` 导出供测试),`files/index.tsx` activate 内 `ctx.registerTerminalLinkProvider` 注册。kernel 零改动。正则复用 marks ABS_PATH_RE 判定思路(复制不提 kernel——一个正则不值跨插件契约);排除 `://`;`path.ts:line:col` 取 line 忽略 col。

**边界矩阵**:相对路径按 spawn 时 `SpawnSpec.cwd`(`src/kernel/sessionSpawn.ts:33,116`)拼接——**cd 漂移天花板如实文档化**(被否:OSC 7 shell 集成追踪,多平台差异 S 项装不下);绝对路径前缀匹配 root 剥相对,区外/不存在**静默**(与 marks 一致;被否 toast 噪音/跳系统文件管理器);宽字符 `charCellMap` 已兜;性能护栏=线性正则(char class 无嵌套量词)+空行快返(xterm 行宽天然有界,不加行长上限);含空格路径须含分隔符防误吃(`sendTransform.ts:102` 先例)。

**裁决**:①provider 落 files 插件(被否 cli-shared——它是 CLI 转录解析层,kernel 禁单插件语义);②cwd 不追踪;③区外静默;④col 忽略只跳行(reveal 契约只有 line);⑤无 hover 幕布预览(零幕布内渲染铁律);⑥无设置键。

**验证**:单测矩阵(绝对/相对/盘符/UNC/:line/:line:col/URL 排除/空格路径/无扩展名反例/root 拼接/区外静默);1421 桩目检 hover pointer、点击开 tab 滚到位、冻结快照回放后点击仍通。

**步序**:terminalPathLinks.ts(新)→ index.tsx 注册 → test 矩阵 → 文件头注释钉 cwd 天花板。

## 3. 跨工作区全局检索(M)

**现状核实**:`src/plugins/session-search/indexer.ts:37-56` cache key=会话绝对路径(天然全局唯一),`:57-77+86-95` prime 按「当前 cwd 作业集」剪枝=**切区必互踢全部他区缓存**(候选页指认属实);`SearchOverlay.tsx:52-66` effect deps [open,cwd],时间 chip 以打开时刻为基准,`applyFilters` 对「引擎不在集合」恒等返回(天然免疫作用域切换);`anchorJump.ts:200-224` openThenJumpToText **不假设同工作区**(cwd/workspaceId 全程透传,miss 落 host.openDiskSession);但 `sessionSpawn.ts:147-175` spawn.open 只 setActiveSession **不切工作区**,`workspace.ts:117-122` setActiveWorkspace 同步零失败态;`RunningZone.tsx:61-63` workspaceId=undefined 的会话侧栏不可见;`indexerTicks.ts:8` 每 tick 60ms 恰一步(缓存命中也是一步)。

**端到端**:Cmd+O→浮层→indexer 按作用域(本区单 cwd/全部=getWorkspaces() 各 root)prime→宏任务逐步 step→输入即内存扫描(**作用域只是喂索引的 cwd 集合,零第二条管线**)→Enter→`locateTargetOf`(entry 需带 workspaceId)→**先 setActiveWorkspace(目标) 再 openThenJumpToText**。先切后跳裁决:miss/opened 降级时用户必须已身处目标区(侧栏/面包屑就位);被否「直接跳不切区」——跳能成但降级路径上下文错位+工作区卡不展开,找不到刚开的会话。

**契约**:`SessionIndexEntry`+`workspaceId`;`SessionIndexer` 构造改收 `cwds: [{root,id}]`;`SessionIndex`+`workspacesTotal/scannedWorkspaces`(进度「N/M 个工作区」);scope 为浮层 useState 不持久化。

**边界矩阵**:扫描中输入→增量上屏+sel 收口;切回本区→stop ticks 重建单区,缓存保留;openDiskSession reject→miss toast,区已切到位可手动重试;8s 定位超时→miss toast 不回滚切换(单向手势);标题命中→纯 open 不定位,区先行切换;双击 Enter→在途单例闸幂等(sessionSpawn.ts:160-166);失效区命中→灰 pill「工作区已移走」**不可跳**(被否「cwd 在就跳」——开出的会话 workspaceId 空侧栏永不可见,比不跳坑)。

**裁决**:①缓存=路径唯一 key+cwd 命名空间留存+**全局条目 LRU 上限 3000**(prime 只剪「cwd===本次 && 不在 live」+超量淘汰;被否 Map-of-Maps 纯增结构、纯 LRU 会把本区热缓存挤光回到互踢;量级 7 区×500 会话≈21MB 字符串可接受);②节奏=每 tick **时间盒排空 12ms**(缓存命中步连做),真读步维持 60ms——否则全部态暖缓存 3500 步×60ms≈3.5 分钟不可用(被否:缩短全局 STEP_INTERVAL_MS,I/O 连发卡帧恰是 indexerTicks 要防的);③失效区不可跳;④chip 不持久化;⑤不做:定时刷新/FTS5/打分/助手入索引。

**设置**:零新键。**行数风险**:`indexer.ts` 已 279 行,本项必超 300 铁则→**先拆 `searchCore.ts`**(searchSessions/applyFilters/snippetOf/时间谓词纯函数迁出)。

**验证**:单测(prime 只剪本区死键/切区零重读/LRU 淘汰序/per-entry workspaceId/失效区灰数据/时间盒上限);目检(双态切换缓存不互踢二次开浮层秒出/跨区 Enter 落正确区+行/扫描中输入不卡/空结果双态/chip 叠加)。

**步序**:拆 searchCore.ts→indexer cwds[]+workspaceId+进度→indexerTicks 时间盒→SearchOverlay scope chip+进度行+先切后跳(chip 段挤则挪 SearchOverlayParts.tsx)。

## 4. 输入历史截断修复 + 浏览抽屉(S-M)

**现状核实**:`src/kernel/promptHistory.ts:16-18` 单键 `tmd.composer.promptHistory.v1`、MAX_ITEMS=200、MAX_TEXT_LENGTH=300;`:70-81` **唯一截断点**在 recordPrompt(`slice(0,300)`,去重置底→push→shift→counts++);`:22-59` 形状 `{items,counts}` 无时间戳/engine/ws 元数据,load 严格校验,save 失败静默;`:110-130` findPromptCompletion 前缀匹配;`usePromptHistory.ts:19-46` ghost 防抖,**suffix 长度无上限**(展示截断缺失);`composerTextareaKeys.ts:1-7` 判定序 IME→下拉→ghost Tab→历史→移交;快捷键盘点:**Cmd+L 全库零命中**(composer 已占 ⌘K/⌘J);`sessionPending.ts` 与历史存储/回填零交叠。

**端到端**:发送→recordPrompt 存**全文**→save 字节封顶淘汰→ghost/召回/抽屉三消费面同 store。抽屉:Cmd+L(composer/global,when 同 ⌘K)→Composer 内局部 useState(不经 drawerOpen 三态机)→HistoryDrawer(items 现读+订阅)→子串过滤+高亮→Enter→`setValue(全文)+setCursor(len)+focus`(整替草稿,回填可编辑不直发)→Esc 关闭不回填(stopPropagation 防穿透)。

**契约**:存储形状不变;`MAX_TEXT_LENGTH` 语义改「ghost 匹配/展示窗口」(startsWith 天然只比对前缀,匹配侧零代码;唯一要钉的是 usePromptHistory suffix 展示截断 ≤300+「…」,accept 返回全文);字节封顶 `MAX_BYTES=512*1024`,save 前 stringify 超限从 items[0] 连 counts 淘汰(排序键=数组序 recency)。

**边界矩阵**:localStorage 写满→save catch 静默(现状已兜);抽屉开着新发送→订阅刷新;无历史→空态;抽屉内键盘不进 composerTextareaKeys(焦点在搜索框);两窗口各自 localStorage 分区互不可见(现状,非本项扩大);promptHistory.ts 139→约 155 行余量足。

**裁决**:①触发键=**Cmd+L**(被否输入触发符——与 CLI triggers 抢命名空间;⌘Y 肌肉记忆弱;⌘K 抽屉加分区——历史非命令语义且拖入三态机);②淘汰=save 时整体检查+shift 最旧(被否记账式 LRU——counts 已有热度,记账是第二真相);③存量截断条目**不打「已截断」标**(被否 schema 打标——无法区分恰好 300 字符的新条目,假阳性,去重置底自愈);④抽屉状态局部 useState 不开新 store;⑤回填=整替(composerReplaceRef 语义,插件内直调不跨插件);⑥无后台扫描,打开才读(同步内存 cache 零 IO)。

**设置**:仅复用既有 `promptHistoryEnabled`(`settingsTypes.ts:120`)——关时 Cmd+L 同闸不触发。**不新增键**。

**验证**:单测(超长全文 round-trip/去重置底替换旧截断条目/512KB 淘汰最旧且 counts 同步/写入 throw 不抛/8000 字符条目前缀命中 accept 全文/ghost suffix 截断 ≤300);目检(Cmd+L 开关/过滤高亮/回填可编辑/Esc 不回填/空态/总开关闸)。

**步序**:promptHistory.ts 去 slice+字节封顶→usePromptHistory suffix 截断→新 HistoryDrawer.tsx(≤300 行)→Composer 挂载+state(超行限则 state/historyOpen.ts 模块单例)→composer/index.ts 注册 `composer.toggleHistory` 命令→两测试文件扩用例。

**示例页偏差**:每条历史的 time/engine/ws 药丸无数据源——本版不做(后置增强需 schema v2);「已截断」药丸删除。

## 6. checkpoint 恢复 dry-run 预览(M)

**现状核实**:`src-tauri/src/checkpoints/restore.rs:42-183` restore_batch=**逐轮手术回退非快照 checkout**,两阶段:阶段一解析计划(untouched 校验 live==after_oid→surgical_erase 精准擦除/Write(before_oid blob)/Delete/skip 带理由),plan 空 `E_Empty`;阶段二 guard+落盘。`diff.rs:17-70` CkptPatch{path,kind A/M/D,additions,deletions,patch,binary},`blob_patch(sidecar,path,old,new)`,**open_batch_patches 已是快照↔工作区先例**。`review.rs:38-110` undo_revert 只写 reverted_paths。`BatchRowParts.tsx:42-91` ConfirmCard 纯文案卡。`diffCache.ts` 批 diff LRU+在途防重+失败显式态——预览必须复用而非旁路。命令登记=commands.rs+lib.rs+ipc.ts 三处。

**端到端**:BatchRow 点回退→现有 setConfirm 两步武装流不变→**ConfirmCard 挂载时**发起 dry-run→预览表替换纯文案段→确认走 doRevert。**抽 `plan_restore(cwd,batch_id,paths)->RestorePlan` 纯函数**(阶段一本来无副作用),restore_batch 消费它;新命令 `checkpoint_restore_preview`=plan+每写入项 `blob_patch(live_bytes,target_bytes)` 补 CkptPatch(live 读一次磁盘)。

**免弹**:plan 为空→免 ConfirmCard 直接 doRevert,E_Empty 前端分支为中性提示「本批已无可回退的改动」;plan 非空但 0/0 行(untouched)照常显示不属免弹。**覆盖警示**:真实「覆盖」只发生在 surgical_erase 成功行——打「覆盖本地」药丸;skip 行以既有 skippedNote 呈现。**否设计页「∩ git 未提交」方案**:git dirty 含会话自己刚写的未提交改动会全员误标恐吓化,账本 untouched/surgical 判定精确到文件更准。

**契约**:`RestorePreview{rows: PreviewRow[], skipped: SkipEntry[]}`,`PreviewRow{path,kind,additions,deletions,overwrites}`;kind 推导=Delete→D(恢复将删除)/批前空侧→A/其余 M;ipc.ts 增 `checkpointRestorePreview` 入 Ckpt 契约区。

**边界矩阵**:preview 与 confirm 之间文件又变→**弹层内冻结预览不刷新**(执行时阶段一用最新 live 重新判定,skip 兜底安全);binary→0/0 行;IPC 失败→回落纯文案+错误短句,**不阻塞确认**;paths 子集回退→吃同一参数;已 reverted 批→既有短路检查挡。

**undo 对称裁决**:undo_revert **复用 revert 预览、不新发 dry-run**(guard 内容=回退前一刻工作区,信息增量≈0,省一条 IPC;被否单独 dry-run——guard 无 per-path plan 结构要新造)。

**0.4.0 交互**:openThenJumpToText/时间线 chip 均只读批清单不触动作,**不动**;TurnFilesChip 维持「仅读」约束,时间线不加恢复入口。`run(spawn_blocking)` 天然不卡主线程;前端 inflight 防重(同 diffInflight 语义),不做定时超时(与既有批 diff 同风险面)。

**验证**:Rust plan_restore 单测(交集/空集/skip 理由);preview 命令单测(binary/子集);桩目检预览表+免弹态+undo 对称;IPC 权限登记核对。

**步序**:restore.rs 抽 plan_restore→commands.rs+lib.rs+ipc.ts 三处登记→ConfirmCard 升级预览表(fileChipCls 配色+「覆盖本地」药丸+截断展开)→useCheckpointActions 接线→测试。

## 7. 额度低水位告警(S)——**实为增量补腿,告警主体 0.2.8 已落地**

**现状核实(候选页前提修正)**:轮询式撞墙预警已在产(commit 8c08a44f,`src/plugins/notify/index.tsx:137-185`):首查 30s+10min 间隔,监控面=运行中会话∪平铺幕布,按供应商去重;阈值键已在 `settingsDefaults.ts:43`(notifyQuotaWarnPercent=10)与 NotifySettingsTab;去重 `quotaWatch.ts:49-70`(内存 Set,**重启失忆**);通道仅失焦闸,**quota 分支不走 shouldNotify=免打扰窗不拦 OS 通知(现存真缺口,顺手修)**;流水已全量记录(kind="quota" 置灰不可回跳)。**余额型不参与**:`!snapshot.windows.length→return` 把 deepseek/relay 纯余额家完全挡掉。

**vendors 逐家盘点**:balanceValue 只有 **deepseek**(`info.total_balance` 本就是 number)与 **relay**(`balanceNum`)做得出;kimi/minimax/zhipu/codex 无余额概念(非解析失败,UI 不渲染该行而非显「—」);百炼无公开 API 恒 unsupported。**claude 窗口**:官方 OAuth 分支直接 throw,唯一推算在 `welcome/quotaWindow.ts:31-54`(纯函数零网络),notify 侧今天拿不到。**凭据懒刷新挂点被否**:只在打开首页时有新数据,不看首页=永不告警,主场景失效。

**增量三腿**:①**余额腿**——poll 分支改判 `snapshot.balanceValue`(types.ts 旁挂 `balanceValue?: number`,两家 adapter +1 行透传),**绝对阈值** `notifyQuotaBalanceBelow`(0=关,货币跟随回包 symbol;被否百分比——无额度分母,两家币种/套餐粒度不同,纯属发明数据);②**claude 窗口腿**——`windowResetFor` 迁 `cli-shared/quota/quotaWindow.ts`(依赖 sessionUsage 本就在 cli-shared,welcome 改 import 纯 cutover),notify poll 对 claude 会话尾读推算(`makeTranscriptTailReader` 通道),`resetAt-now < notifyQuotaResetMinutes`(默认 30)→报「N 分后重置」;被否挂 welcome/tokens 聚合——跨插件反向依赖破铁律;③**去重腿**——**扩 notify-log.json 头部 `quotaSeen: [{k,at}]`**,键沿用 pickQuotaWarnings windowKey+引擎前缀(窗口键自带 resetsAt 天然按周期翻新,余额键用首次越线小时桶),随 notifyLogDays 裁剪同批清理;被否新状态文件——多一个生命周期要管的文件。

**顺手修真 bug**:quota 分支改走 dispatch 同款三闸(NotifyKind 加 "quota",shouldNotify 补 `notifyOsQuota` 分支),免打扰窗拦 OS 通知但流水照记。OS 通知+流水而非仅应用内:撞墙是「回来才发现」型事件。

**边界矩阵**:重启失忆→持久化后消失;状态写坏→按无记录处理宁多勿漏;多会话同供应商→seenProfile 归并沿用;dsh/官方 OAuth/unsupported→catch 静默;**minimax 口径风险**——windows 语义是「剩余」百分比而 QuotaSnapshot usedLabel 恒「已使用」,实现时逐家断言单测钉死;300 行铁则:两腿抽 `quotaWatch.ts` 纯函数(现 70 行余量足)。

**设置**:`notifyQuotaBalanceBelow`(默认 0=关)+`notifyQuotaResetMinutes`(默认 30)归 NotifySettingsTab 免打扰卡旁;既有 notifyQuotaWarnPercent 不动。

**验证**:阈值/去重/窗口纯函数单测;minimax 口径断言;三闸矩阵(dnd 内 OS 静+流水记);目检越线发一条+同窗二次不发+重启后仍去重。

**步序**:types+两家 adapter 透传→quotaWindow 迁 cli-shared+welcome 改 import→quotaWatch.ts 补两腿纯函数→notify poll 接线+三闸修复→notify-log quotaSeen→NotifySettingsTab 两键→测试。

## 通用边界(五项全适用)

- 不做清单沿用 041:定时器调度器(项 7 的 10min 轮询为 0.2.8 既有,非新增)、幕布内二次渲染、云服务、强制登录、审批卡、高频轮询;被裁 8 项不翻案。
- kernel 改动面:仅项 4 promptHistory 常量语义(既有文件);项 1/3/6/7 零 kernel 结构改动。Rust 仅项 6 一条只读 preview 命令(plan_restore 抽取)。
- 插件落位:项 1 files;项 3 session-search;项 4 composer+kernel 历史存储;项 6 checkpoints(Rust+TS);项 7 notify+cli-shared+welcome(cutover)。
- 随手带四项(搜索 Aa/.*+计数、检索多命中展开、⌘± 字号、anim Windows reveal)实现口径随对应主项一起走,不单独立项。
