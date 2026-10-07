# 0.3.2 W2 标注×检查点存证链设计(marks × checkpoints)

- 日期:2026-10-07
- 状态:已定稿(五决策经大仙批准;本文对 10-06 逻辑细化评审的两处订正见「方案取舍」)
- 前置:[0.3.2 工作流整合规划](../../brainstorm/2026-10-06-032-workflow-integration.md)(W2 方向)、
  [逻辑细化评审](../../review/2026-10-06-032-workflow-logic-review.md)(二轮 W2 节)、
  [交互原型](../../design/workflow-integration-032.html)(W2 场景)

## 背景与目标

现状断点:标记随 prompt 发出后与检查点零关联——账本 anchor 只记 prompt 文本 +
engine/model/thinking(checkpoints/index.tsx anchorMeta),标记发出后「标了什么 →
哪轮改的 → 怎么回滚」链条断;标注卡止步「已发送」,时间线节点不显本轮携带。

目标:锚点随批固化标注引用;标注卡派生「已生效」徽章(该范围被某轮批次实际改写)
与「参与轮次」反查;回退批次联动降级。**marks sidecar 零改动,存证真相源唯一
(checkpoints 账本),生效判定全在前端 join(零写路径)。**

## 决策明细

### D1 载荷通道:PromptSentEvent 增可选 ranges

`PromptSentEvent` 增可选 `ranges?: { id, path, startLine, endLine }[]`——kernel
泛化命名「随发携带的文件区间引用」,不带 marks 插件语义(合规「单插件语义不入
kernel」;promptGate 只透传)。`text` 载荷维持换块前原文(events.ts 既有契约:
prepareSendPayload 前的展示文本)。

发射口两处带、一处不带:

- useComposerSend:transforms 翻转 staged→sent 之后、emitPromptSent 时,
  marks/sendTransform 新导出 `carriedMarks()` 读 lastFlip 名单映射四字段
  (只读不消费,undo 语义不变)。
- RelayDialog:接力首发携带标注同填(W1 已核实:carried 是同 cwd 真实 store 条目
  带 id,写入成功翻 sent 与发射同窗,refs = carried 名单)。
- useComposerDrawer **不带**:抽屉路径不跑 send transforms、不注入标注
  (现读 composerPendingCount 提示「引用标记仍待下次输入注入」证实),
  带 ranges 会读陈旧 lastFlip,必须留空。

边角:写失败回滚 → 锚点已带 ranges 但标记退回 staged,沿用既有孤儿锚点语义
(空轮封口,无证据派生,无害)。/model 等斜杠命令本就不广播,天然不沾。

### D2 账本固化:anchor 写入 + seal 修订行携带 + list 回读

`checkpoint_anchor` IPC 增 marksRefs 参数;`LedgerEntry` 增
`marks_refs: Vec<CkptMarkRef>`(serde default,旧账本行反序列化为空数组);
**seal 修订追加时从 anchor 行复制**(turn 行是同 id 修订行,「读取以最后一行为准」
不复制即丢);`checkpoint_list` 回读进 `CkptBatch.marksRefs`(open 批读 anchor 行,
sealed 批读 turn 行,两路都有)。

### D3 已生效 = 派生徽章,不落盘

`MarkState` 五值不动(sidecar 零迁移)。徽章三态:待发送(pending/staged)→
已发送(sent,无证据)→ 已生效(派生:sent 且存在相交且未回退的批)。

判定口径:批 patch 的**老侧 hunk 区间**与标记区间相交,且文件 status = M
(A/D 不参与:A 与标记先行存在矛盾,D 走 lost 语义)。纯函数进新模块
`marks/evidence.ts`;patch 经既有 diffCache 懒取(命中标注路径的批才需要)。
回退联动降级 = join 口径天然免费:批翻 reverted(或文件级 live=reverted)即
不再计入,徽章自动回落「已发送」。

多轮携带:参与轮次列全部锚点轮,每轮三值——相交未回退=已生效 / 相交已回退=
已回退 / 未相交=未改写;「生效于」取最早相交且未回退批次。进行中轮(open 批)
显「进行中,封口后判定」。

### D4 参与轮次反查:跳中央批审阅单

标注卡「参与轮次」行(轮次号 + 引擎名),点击 `openBatchTab` 打开既有批审阅单
(含回退动作,闭环就在里面),零新桥。

### D5 时间线节点显携带

`TimelinePanel` 行增「标 ×N」小徽章(读 `CkptBatch.marksRefs.length`)。

实现订正(落地时):徽章落在 `BatchRowHead`(批头)而非 TimelinePanel 行 ——
时间线行是用户消息锚非 CkptBatch 载体,批头才是;D4 的轮次片同理只显轮次号,
引擎名未显(MarkRound 不带 engine,批审阅单里已有);D3 的「生效于最早相交批」
单独标注未做,徽章 + 轮次片语义已覆盖。

## 方案取舍

| # | 选定 | 否决(附理由) |
|---|---|---|
| 1 | 老侧 hunk 区间相交 | 评审二轮 new-range 口径:标记行号冻结在发送时点 = 锚点时刻文件空间,与 hunk 老侧(批前空间)同空间精确对齐;new-range 是批后空间,批上方有插入时冻结区间被 hunk 吞(假阳性)、有删除时漏判(假阴性)。unified diff 头两段区间都在,解析成本相同 |
| 2 | 既有面按需 join:checkpoint_list(marksRefs+文件清单)+ checkpointBatchDiff(diffCache 懒取) | 评审二轮「全量读 ledger.jsonl 建 cwd 级索引」:需新 IPC 面 + 权限登记;patch 仅命中标注路径的批需要,懒取有界;list 已够徽章与轮次列表 |
| 3 | 已生效派生不落盘(零写路径,与评审二轮同向) | MarkState 增 effective 持久态:sidecar 迁移 + 回退降级要写回链;join 派生回退联动免费 |
| 4 | 反查跳 openBatchTab 批审阅单 | 跳右栏时间线定位:需新 reveal 桥;批审阅单信息密度高且自带回退动作 |
| 5 | join 域 = 当前 cwd 全部活会话批清单 | cwd 级全历史批枚举(含已退出会话):需新枚举面,真实痛点再上。天花板以 `ponytail:` 注释钉在 evidence.ts |
| 6 | RelayDialog 首发同填 refs | 呈批时曾划 non-goal;经 W1 落地核实 carried 是同 cwd 真实条目、翻 sent 与发射同窗,补一行即闭环——订正采纳评审二轮口径 |

区间口径天花板:老侧相交是行号级近似,标记区间与批前空间的对齐依赖「sent 行号
冻结」机制;内容级精确比对(fingerprint 重放)不做,徽章语义「参与改写轮次」
够用,升级路径注释留 evidence.ts。

## 改动面与行数预算

- kernel:events.ts(PromptSentEvent.ranges)+ promptGate.ts(emitPromptSent 可选参)。
- marks:sendTransform.ts 增 carriedMarks();新 evidence.ts(hunk 老侧解析 + 相交 +
  轮次三值推导,纯函数 + 测试);panel.tsx MarkCard 徽章与参与轮次行(236 行 +
  ~40,预算内)。**store.ts(297)不动。**
- checkpoints:index.tsx promptSent 消费 e.ranges 透传 captureAnchor;ipc.ts
  checkpoint_anchor 参数 + CkptMarkRef 类型 + CkptBatch.marksRefs;store.ts
  captureAnchor 透传;TimelinePanel 徽章(279 行 + ~10 贴线,超则下沉
  batchStateMeta 侧)。
- Rust:mod.rs CkptMarkRef + LedgerEntry.marks_refs;commands.rs capture_anchor
  参数;turn_entry.rs seal 修订行复制;view.rs list 回读;~60 行 + 测试。
- i18n:已生效 / 已回退 / 未改写 / 进行中 / 参与轮次 等 en/ja 词条。
- 跨插件消费先例:marks → checkpoints 的 getCkptBatches/useCkptVersion/diffCache
  属「经兄弟插件 store 声明的具名数据函数窄口读写」,import 处注释声明先例
  (架构文档 app 树例外条款)。

### 同版 B 批(终审遗留清账)

1. W1 P2 补测 ×3:transcriptDigest truncated 双旗叠加、dsh relay fixture、
   overlay 编辑 round-trip。
2. daySessions 转活双行瞬态:磁盘行与活行按会话 id 合并去重(活行优先),
   消 ≤60s 双行窗。

## 验证

- evidence 纯函数测试:老侧 hunk 解析(增/删/改/上下文边界)、区间相交
  (相切/包含/跨 hunk/多文件)、A·D 排除、reverted 降级、进行中轮三值。
- Rust 级联测试:anchor 带 marksRefs 写入 → seal 修订行携带 → list 回读 →
  旧账本行缺省空数组兼容;cargo test && clippy && fmt --check。
- 桥协议契约测试:PromptSentEvent.ranges 主口/接力口同填、斜杠命令不沾、
  写失败回滚不留证据。
- 1421 桩目检:发标 → 批封口改写 → 徽章升「已生效」→ 回退降级全链;时间线
  「标 ×N」;参与轮次点击开批审阅单。
- 门禁:pnpm typecheck && test && check:arch-boundary && check:file-size &&
  build;react-doctor 100;UI 真窗口目检。
