# 0.3.2 规划 · 日常工作流整合

- 日期:2026-10-06
- 状态:方向已定稿(大仙拍板「日常工作流整合」);交互原型待目检
- 交互原型:[design/workflow-integration-032.html](../design/workflow-integration-032.html)

## 背景与目标

0.3.1 收口后打磨池已尽(A-G 七批全落地),桌面无已知可感缺口,留观池全是「下次动到顺手」级小项。大仙否决了 MCP 管理面/平板双栏/全文检索/审批代发四个既有池方向,拍板 0.3.2 主线 = **日常工作流整合**:把 files / marks / checkpoints / daily-journal / session-board / session-relay 这些各自成型、但需要手工串联的插件,焊成一条顺手的日常作业流——**早续起 / 午存证 / 晚成文**。

现状断点(插件群摸底,2026-10-06 子代理核证):

- relay 摘要只拼用户消息(relay.ts:76 readSessionUserMessages),助手结论与工具产出不入摘要,跨引擎换轨半失忆。
- 标记随 prompt 发出后与检查点零关联(anchor 只记 prompt 文本+engine/model/thinking,无 marks 维度),「标了什么 → 哪轮改的 → 怎么回滚」链条断。
- journal 与 board 双向零互链;便签/文章没有「今日接着干」出口;board「结束-未查看」治理态无消费方。

已核实划掉:「journal 生成会话污染 checkpoints 账本」非问题——生成会话 prompt 走 oneshot @file/argv 不经 composer 无锚点,文章落 ~/.tmd-cli/daily/ 在 sidecar 仓域外,无主写入按「宁漏勿串」不归属(attribution.rs:6-11)。

## 三条工作流

### W1 接力不失忆(relay × sessionDigest)

- relay 摘要源 readSessionUserMessages → daily-journal 的 sessionDigest 角色化摘录管线(用户/助手/工具三角色块,预算内截断,预算做成常量)。
- 接力 overlay 增摘要预览与「携带未发标注」随行(标注随首条 prompt 注入引用块)。
- 改动面:session-relay/relay.ts + overlay;数据面零新增。

### W2 标注 × 检查点存证链(marks × checkpoints)

- promptSent 通道给 anchor 增 marks 引用维度;时间线节点显「本轮携带标注」。
- 标注卡徽章三态:待发送 → 已发送 → **已生效**(新增:该范围被某轮批次实际改写);标注卡增「参与轮次」反查,点击跳审批线节点;回退批次联动徽标降级。
- 改动面:kernel promptGate 载荷、checkpoints 账本 meta(Rust)、marks 卡片、右栏双面板互跳。marks/store.ts 297 行贴线,动前预算拆分。

### W3 昨日未完今日续起(journal × board)

- 文章/摘录生成侧注入会话引用,点击 openDiskSession(与侧栏磁盘行/board 同语义)。
- JournalPanel 顶部「昨日未完」聚合:空闲/未查看会话 + 未勾便签;勾便签即摘除,次日照挂。
- 改动面:genSession/promptGen、JournalPanel;board 复用 boardData 零新增。

## 方案取舍

- 选定:三条桥接缝,零新抽象、零新数据真相源,全部复用既有管线(sessionDigest/boardData/composerExt/promptGate)。
- 否决:新「任务」一等抽象绑定文件+标记+会话+批次——概念重、迁移面大,YAGNI;三条缝焊上后日常闭环已成立。
- 否决:relay 摘要 AI 重写——不可预期且引入新额度依赖,结构化截断够用。
- 否决(本版):board 泳道重构、marks 预览增强(markBridge 已通)、平板双栏/手机全文检索/审批代发(顺延,待真实痛点)。

## 验证

- 原型:docs/design/workflow-integration-032.html(三场景全交互,橙「新」角标标增量),先目检后开工。
- W1:relay 摘要单测覆盖三角色块与截断顺序;接力链路桩目检。
- W2:账本 anchor meta 级联测试(写入→封口→回退→徽章降级);双面板互跳目检。
- W3:生成侧会话引用注入的 round-trip 测试;「昨日未完」聚合口径(空闲=board 五态、便签=未勾)单测。
- 门禁:pnpm typecheck && test && check:arch-boundary && check:file-size && build;Rust 侧 cargo test && clippy && fmt --check;UI 目检 pnpm tauri:dev 真窗口;react-doctor 100。
