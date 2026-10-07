# 0.3.2 工作流整合设计评审 · 逻辑细化(二轮)

- 日期:2026-10-06
- 状态:已完成(设计逻辑定稿,待开工)
- 上游:[brainstorm/2026-10-06-032-workflow-integration.md](../brainstorm/2026-10-06-032-workflow-integration.md) · [原型](../design/workflow-integration-032.html)
- 事实基线:三路代码侦察(W1/W2/W3),全部结论带 file:line 存档于本会话;本文只引关键锚点。

## 评审结论

原型三场景的交互形态成立,但二轮代码事实把三条工作流的**实现逻辑**收窄到比一轮设想更小的改动面,并暴露三个一轮没看见的点:①W1 换源顺带修 dsh 接力摘要空白;②W2 生效判定可以走「零写路径」(marks sidecar 完全不动);③W3 聚合口径必须补「今日零点后无活动」条件,否则点过的会话一直挂在聚合里。

## W1 接力不失忆 · 逻辑链

现状链(全部实测):入口(命令 `session-relay.to-engine` / 异常退出卡)→ `setRelaySource` → RelayDialog → `buildRelaySummary`(relay.ts:76-99,最近 10 条**用户**消息,单条 500 字代理对安全截断,总 8KB 从最旧丢)→ `host.createSession(target, ws.root, ws.id)`(RelayDialog.tsx:99-101,重试复用 `createdRef` 防堆空会话)→ `prepareSendPayload(triggers 清空)` → `writeSession` → `emitPromptSent(summary)`(:105-129)。源会话不触碰(全文无关闭/写入调用)。overlay 现状:目标引擎 chip 单选 + **摘要 textarea 可编辑** + 截断黄标。

细化后的目标逻辑:

1. **摘要源换 `readSessionTranscript`**。关键事实:转录适配器 9 家族全声明(claude/codex/dsh/grok/kimi/opencode/omp·pi/qoder·qoder-cn),而 `readSessionUserMessages` dsh 未声明——现状 dsh 会话作 relay 源时摘要是「未提取到历史输入」占位。换源即免费修复。
2. **压缩管线抽纯函数入 kernel**。sessionDigest 的 `capLine`/`blockLine`(sessionDigest.ts:33-54,reasoning/system 丢弃,user/assistant/tool 压单行)+ 末条助手结论保底(:62-66,截断时补「助手(结尾):」400 字)是通用原语,输入是 kernel 统一 `CliTranscriptBlock`,不含 CLI 私有格式知识 → 沉淀 `kernel/transcriptDigest.ts`;daily-journal 与 session-relay 各自装配小节头/首尾行。理由:跨插件复用必须过 kernel 或 cli-shared,此处是通用原语非 CLI 格式知识,kernel 合规。
3. **预算独立常量**:`RELAY_SESSION_BUDGET = 6000` 字符 + 角色行预算放大(user 1200 / assistant 1000 / tool 200),比例沿 DIGEST_CAPS。接力要能继续干活,粒度须比文章材料(4000)粗;总量级与现状 8KB 相称。预算/截断顺序沿 digest:顺序累计超预算截断、末条助手结论恒保。
4. **首条 prompt 拼装**:首行「接力自 {引擎} 会话…」+ 角色化块 + 尾行「请接着以上进度继续工作…」不变;摘要仍可编辑(textarea 保留),编辑后按编辑值发送。
5. **携带未发标注口径 = 仅 staged**(composer 已挂 chips 的),pending 不带。relay 不走 composer transform 链,侧直接 import marks 声明的纯函数 `serializeMark`(sendTransform.ts:26-41,`path:Lx-Ly` + 缩进摘录 + 备注行)拼引用块附在摘要后;插件消费「声明的纯函数模块」有 mobile 树先例。发送成功后对这些标注执行与 `marksSendTransform` 相同的 sent 翻转;失败不翻(现状 undo 语义对齐)。
6. **不变**:源会话不动、接力是快照式无后续同步、写入失败留框重试。

## W2 标注×检查点存证链 · 逻辑链

现状关键事实:promptSent 载荷仅 `{sessionId, text}`(events.ts:69-72,text 截 400);checkpoints 消费时 engine/model/thinking 从 host 快照另取(index.tsx:59-67);captureAnchor → Rust `anchor_turn` 落 `ledger.jsonl`(同 id 多行取最后=修订);封口三触发(turnSettled / 下一条 promptSent 隐式封 / sessionExited 兜底)+ 死锚 30min 代封;TurnFile = `{path, patch(unified diff 文本), additions, deletions}` **无结构化行区间**;restore 纯 sidecar 账本(不用 git),回退不删账、states.json 记 reverted、guard 条目反悔;Mark = `{id, path, startLine, endLine, fingerprint, excerpt, note, state, createdAt}`,state 五值 `pending|staged|sent|drifted|lost`,**sent/staged 行号冻结**(relocate 跳过,store.ts:271-300);两账零关联键。

细化后的目标逻辑:

1. **载荷扩展**:`emitPromptSent` 载荷加可选 `marksRefs?: {markId, path, startLine, endLine}[]`。填法:useComposerSend 在 emit 前(此时 transform 已翻 sent)向 marks store 取「本批随发名单」(store 暴露 `takeLastSentRefs()`);RelayDialog 接力首发携带标注时同填。/model 等斜杠命令本就不广播,天然不沾。
2. **Rust 最小面**:`captureAnchor` 透传 → LedgerEntry 加 `marks_refs: Option<Vec<MarkRef>>`(serde default,旧账本行兼容),`anchor_turn` 原样落账。**生效判定不做在 Rust**:hunk 相交是纯函数,patch 文本本就随 turn 条目到前端。
3. **生效判定(一次性事实,封口时刻)**:标注 M 生效于批次 B ⟺ B.turn_files 存在 f: `f.path == M.path` 且 f.patch 任一 hunk 的 new-range 与 `[M.startLine, M.endLine]` 相交。依据:封口=改写刚落盘,此刻磁盘行号=hunk 新行号;而 sent 标注行号自发送起冻结(relocate 跳过)——两边行号口径天然对齐,这是现成机制送的顺风车,不需要任何新同步。判定结果**不随后续漂移重算**(漂移只影响未来轮次)。
4. **零写路径(核心设计)**:marks sidecar **完全不动**。事实链「哪个标注参与哪轮/生效于哪批/该批是否已回退」全部在前端渲染时 join:锚点行(marks_refs)× turn 条目(patch hunk)× states.json(reverted)。回退联动降级徽章 = join 出 effective_batch 已 reverted → 显「已发送(已回退)」,无需任何降级写回。存证真相源唯一(checkpoints 账本),marks 保持纯标注。join 索引:账本 TS 侧已有读取面,面板打开/账本变更时全量读 jsonl 建内存 Map(markId → 轮次列表),账本是追加行小文件。
5. **多轮携带口径**:同一标注被多轮携带(重发)→ 参与轮次列全部锚点轮,各轮标三值:相交未回退=已生效 / 相交已回退=已回退 / 未相交=未改写。「生效于」取最早相交批次。
6. **进行中轮**:锚点已带 marks_refs(发出即记),turn 未封口 → 参与轮次显「进行中,封口后判定」;轮封口零差异时该轮标未改写。

## W3 昨日未完今日续起 · 逻辑链

现状关键事实:五态 `running|idle|ended-new|ended-seen|archived`(boardData.ts:10),idle=活会话无进行轮(**无超时概念**,逐渲染推导),ended-new=无归档标记且 modifiedAt<14 天,**已查看无显式写入口**(仅归档动作+14 天窗);便签月档 JSON `{text, images, updatedAt}` **无勾选字段**,且**不进文章生成**(buildGenPrompt 无 notes 入参);文章契约(promptGen.ts 头注释):# 标题+总览+## 分节+## 未完事项;「昨日」= 本地零点切天,journalSchedule 默认 08:00 生成前一日。

细化后的目标逻辑:

1. **聚合口径(精确式)**:「昨日未完」= 满足下列之一且 **activeTs/modifiedAt < 今日本地零点**(今日零点后无活动——一轮设计漏了这个条件,点过的会话会一直挂着):
   - 昨日开始(rowDayKey 按开始时刻归日)且当前 live idle 的会话(跨夜挂起);
   - 昨日结束且 ended-new(未查看)的会话;
   - 昨日(含更早)未勾便签。
   不引入「已查看」新写入口、不解析文章「未完事项」节(LLM 输出脆弱;该节本就渲染在文章里,上下文相邻)。
2. **便签加 `checked` 字段**:DayNote 增 `checked?: boolean`(serde/默认 false 兼容旧档);勾选只影响聚合摘除,不改便签编辑/文章生成链。未勾便签次日续挂,直到勾掉。
3. **会话引用注入契约**:promptGen 契约增一条——分节正文提到具体会话时输出行内标记 `[会话|HH:MM|profileId|标题]`(四段与当日会话清单行同源);ArticleTab 渲染层解析标记 → 与 daySessions 清单**枚举校验**(四段全匹配才可点)→ 命中渲染为链接,点击 `openDiskSession` 同语义;校验失败降级纯文本。宁缺勿错:LLM 编造的标记永远点不开也看不出是链接。
4. **「续」的动作语义**:live idle → focus 该会话终端;ended-new → openDiskSession 续聊(与 board/search 同语义);便签行 → 勾选摘除(无「续」按钮)。摘除后聚合计数减一,今日零点后 activeTs 更新的会话自动出列(条件 1 的后半句),两条摘除路径互为兜底。
5. **聚合位置**:ArticleTab(昨日文章 tab)顶部。理由:与文章「未完事项」节上下文连贯,早晨打开昨日文章即见;JournalPanel 右栏窄,放不下行级操作。数据源 = useBoardSessions + daySessions + notes,全现成,零新增数据面。

## 一轮→二轮修订对照

| 一轮说法 | 二轮事实 | 修订 |
|---|---|---|
| W1 换 sessionDigest 管线 | 管线在 daily-journal 插件内;dsh 缺 readSessionUserMessages | 抽纯函数入 kernel;顺带修 dsh 占位 |
| W2 anchor meta 记 marks 引用+双端 UI | TurnFile 无结构化区间;sent 标注行号冻结;账本已带 patch 文本 | Rust 只加字段;生效判定前端 join;零写路径 |
| W3 勾便签即摘除 | DayNote 无 checked 字段 | 加字段+兼容默认;聚合补「今日零点后无活动」 |
| W3 文章会话引用可点 | 文章由 LLM 生成,无标记契约 | 四段标记+枚举校验+降级纯文本 |

## 风险与验证(增补)

- W1:relay 摘要单测(三角色块、预算截断顺序、末条助手保底、代理对安全);dsh 源接力不再占位的 fixture 测试;overlay 编辑后按编辑值发送的 round-trip。
- W2:marks_refs 载荷契约测试(ask 作答/斜杠命令不带 refs);hunk 相交纯函数单测(边界相切/跨 hunk/多文件);旧账本行无字段反序列化兼容;回退后徽章 join 降级的组件测。
- W3:聚合口径单测(跨零点/今日动过/便签勾选);checked 字段旧档兼容;标记枚举校验(LLM 编造标记降级)。
- 门禁照旧:typecheck/test/arch-boundary/file-size/build + cargo 三件 + tauri:dev 目检 + react-doctor 100。
