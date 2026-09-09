# checkpoints 工作区外文件入账设计

- 日期:2026-09-10
- 状态:已落地(当日实施)

## 背景与目标

缺陷实证:omp CLI 会话(cwd = `~/.tmd-cli/default`)让 AI 写 `~/.tmd-cli/plugins/helloworld/plugin.json` 等文件后,审批线始终空白。三道闸门逐层把工作区外路径丢弃:

1. 前端 `normalizeEditPath`(editWatch.ts,editMarks 与 omp/pi/codex/grok 四家 JSONL 适配器共用):`~/`、cwd 外绝对路径一律丢弃;
2. Rust `record_edit` 拒绝对路径与 `..`;
3. git 归因结构性只管仓库内(文档既有声明,本次不变)。

目标:工作区外的 AI 写入事件入账、可见、可应用;批前像不可知的首轮**禁回退**(用户拍板:无前像无法区分「批内新建」与「覆盖既有文件」,回退可能误删用户文件);**工作区内既有账本行为零漂移**(相对路径纪律逐字旧则、原文存储)是硬约束。

## 方案取舍

| 方案 | 结论 | 理由 |
|---|---|---|
| 绝对路径直接入账 + 零 schema 变更 | **选定** | 账本路径字段本是 String,`root.join(绝对路径)` = 绝对路径本身,apply/restore/diff/seal/guard 全部 IO 点机械上已正确;只需松开入口两道闸 + 单点归一。无前像禁回退复用既有编码 `existed_before=true + before_oid=""`,restore 显式跳过,零新字段。 |
| 显式 external 标记 + 独立外部批次链 | 否决 | schema 加字段、一轮改动拆两批,批原子性变差;无对应收益。 |
| 「额外监控根」白名单配置 | 否决 | 锚点基线照样不知道哪些外部文件会被碰,只是把边界挪了位置,还引入配置面。YAGNI。 |
| 无前像按「新增(A)」记账(回退即删) | 否决 | 会把用户既有的外部文件(如 plugin.json)直接删掉,真实数据丢失风险。 |
| 外部文件只读展示(禁回退也禁应用) | 否决 | 审批线对外部文件失去操作价值;应用语义本就安全(写回批后像)。 |

### 数据流(3 个触点)

1. **前端 `normalizeEditPath` 合同放宽**:剥引号/`./` 仍做;cwd 内绝对路径相对化不变;cwd 外绝对路径与 `~` 形式**原样上抛**。判别与拒绝全部下移 Rust,单一信任闸。opencode 适配器原样直传 `filePath`,补接同一函数(cwd 内绝对路径必须相对化,否则被误判外部)。
2. **Rust `canonicalize_event_path`(唯一闸,新模块 path.rs)**:`~/` 用 `dirs::home_dir` 展开 → 词法归一(`.` 消除、`..` 弹一层,根处越界截断)→ 分类:绝对 = 外部收;干净相对 = 内部收(保持相对存储,旧账本兼容);归一后带父级逃逸的相对路径,拒。裸 `~` 与 `~other` 形式拒。
3. **封口 `build_events_turn_files`**:无前像且路径绝对时保守记 `existed_before=true`、`before_oid=""`
、`status="M"` —— 后像与 diff 照常固化(可见/可应用);restore 对该编码显式跳过(理由「工作区外批前像不可知,禁回退」),同批工作区内文件回退不受影响。次轮起跨轮前像链(`latest_turn_after`)供应前像,回退能力恢复。open 批状态符同步(外部无前像记 M 不记 A)。

### 派生修正

- **live 分类**:`classify_turn_file` 对绝对路径走非 git 两档(same/changed)—— 外部文件永远不在用户仓库 dirty 集,同容会被误判 committed 把批提前推 done。
- **UI**:`BatchFile.noBaseline` 透出(serde camelCase);面板 FileRow 与审阅单 FileSection 加「无前像」徽标、单文件回退入口摘除;「回退整批」集合两侧排除 noBaseline;审阅单文件列表分「工作区外」组。
- **安全面收窄**:伪造 PTY 标记无法借「A → 回退即删」删外部文件(禁回退在 restore 后端再守一道);sidecar 快照不越出同用户可读范围。

### 固有边界(明示)

- **UI**:`BatchFile.noBaseline` 透出(serde camelCase);面板 FileRow 与审阅单 FileSection 加「无前像」徽标、单文件回退入口摘除;「回退整批」集合两侧排除 noBaseline;审阅单文件列表分「工作区外」组;路径全量直显(不折叠 ~,目录可辨识优先)。
- git 归因会话不变(结构性只管仓库内)。
- Windows 盘符绝对路径不覆盖(前端 normalizeEditPath 已拒盘符)。

## 验证

- Rust 新测试 `tests/events_external.rs` ×4:路径归一(绝对词法归一 / ~ 展开 / 相对逃逸与空拒绝 / 工作区内原文存储)、首轮禁回退 + 同批工作区内照常、跨轮前像链恢复回退、open 批 M 语义与工作区内新建仍 A。
- 既有 `events_路径逃逸拒绝` 用例收窄到相对逃逸(绝对路径入账是有意合同变更)。
- 前端 `editWatch.test.ts` 断言随合同翻转(cwd 外上抛 / ~ 上抛);cli-omp 敌对用例翻转(~ 入账、逃逸拒)。
- 全量:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`;`cargo test && cargo clippy --all-targets -- -D warnings && cargo fmt --check`。
- 桩目检(1421):omp 会话 cwd `~/.tmd-cli/default`,注入外部写入事件 → 审批线出「工作区外」组 + 无前像徽标 + 回退入口摘除;工作区内文件行行为不变。
