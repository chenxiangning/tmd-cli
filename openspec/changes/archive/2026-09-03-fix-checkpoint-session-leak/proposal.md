# Proposal: 审批线并行会话串批修复 —— 会话磁盘事件流归因(readSessionEdits)

> **状态**:Implemented · 2026-09-03 代码实装完成,全量门禁绿
> **验证**(2026-09-03):typecheck 零错 / vitest 643 绿(含 omp 适配器契约 7)/ arch-boundary 通过 / file-size 通过(checkpoints/restore.rs 拆出 apply.rs、tests.rs 拆出 tests/restore.rs)/ build 通过 / cargo test 93 绿 + clippy -D warnings + fmt
> **用户报告**:同工作区并行 2 个 omp 会话编辑文件,第二个会话改的文件跑到第一个会话的批次里;/model 这类纯切换命令也挂上了文件变更

---

## Why

审批线的设计契约是「固化内容 = 工作区 + 会话 id + 轮次」,账本键控确实是三元组,但**归因内容**没有跟住:omp 未声明 `editMarks`,锚点固化为 `git` 归因 —— 窗口推断取全仓 dirty 集,靠 mtime 落窗 + 「最近提示者赢」仲裁。并行会话轮次天然重叠,「最近提示」与「实际写入者」无关:

- 会话 A 锚点 ts=100(open),会话 B 锚点 ts=50(open);B 在 ts=120 写文件,mtime 同时落在两个窗口,`max_by_key(锚点 ts)` 判给 A —— **B 的写入进了 A 的批次**(用户截图实证)。
- 反向同理:任何 prompt(包括 `/model` 纯切换命令)都张成一个 open 窗口,把并行会话在途写入整个吸进自己的批次(第二张截图:`/model` 批挂了 3 文件 +209/-28)。

架构文档 §8.1 已把这条记为「已知残余歧义:纯文件系统事实无法区分谁是写入者」。结论:**git 窗口推断在并行场景结构性不可救**,必须给走 git 推断的 CLI 按会话隔离的写入信号 —— 本变更一次接入 omp / pi / codex / grok 四家,claude 已有 PTY 标记归因无需处理,kimi / qoder 待实证后跟进。

## What Changes

- **内核契约**(`src/kernel/cli.ts`):`CliProfile` 增加可选 `readSessionEdits(cwd, cliSessionId, sinceTs)` 与 `CliSessionEdit { path, ts }` —— 从该 CLI 自己的会话 JSONL 提取 AI 写入事件。每会话一个流文件,天然按会话隔离,并行会话零串扰;声明后与 `editMarks` 等效,锚点走 `events` 归因
- **cli-omp 插件**(`edits.ts`):实现适配器 —— 定位 `~/.omp/agent/sessions/<slug>/<ts>_<uuid>.jsonl`,尾窗(2MB)读,解析 `edit`/`write` 工具结果的 hashline 快照头 `[path#TAG]`(write 优先 `details.resolvedPath`)与条目自身 timestamp;水位线增量,懒 flush(文件未建)返回 `[]` 非失败
- **cli-pi / cli-codex / cli-grok 插件**(各 `edits.ts`):同一契约、各自磁盘真相 ——
  pi(~/.pi/agent/sessions,pi 族布局):`edit`/`write` 工具结果正文 "Successfully replaced/wrote … in/to <abs path>";codex(~/.codex/sessions rollout):`custom_tool_call` name=apply_patch 的补丁头 `*** Update/Add/Delete/Move to File:`,定位结果按会话 id 缓存避免轮询全树扫;grok(~/.grok/sessions/<enc(cwd)>/<uuid>/updates.jsonl):ACP `session/update` `tool_call` 事件,供应商自分类 `x.ai/tool.kind === "edit"`,秒级 ts ×1000
- **checkpoints 插件**(`index.tsx`):声明适配器的会话按 4s 轮询拉增量事件 → `recordEdit` 落账(open 批次实时可见);`promptSent` 先拉净上一轮尾巴再落锚、`turnSettled`/`sessionExited` 先拉后封,链式保证结算完整 —— 对所有声明适配器的 CLI 生效,新增引擎零改动
- **迟到守卫**(`events.rs`/`commands.rs`):`checkpoint_record_edit` 增加 `ts` 参数(PTY 标记路径传 null 不受影响),早于锚点的事件 = 上一轮尾巴,直接丢弃 —— 拉取迟到、水位线重放都不会串轮
- **文件规模铁则拆分**:`checkpoints/restore.rs`(505 行)拆出 `apply.rs`(apply_batch 镜像语义独立成文,PlanOp 转 pub(super));`checkpoints/tests.rs`(512 行)拆出 `tests/restore.rs`(回退/应用测试簇),沿 events/dead/parallel 既有惯例

## 决策(decision)

### D1 信号源:会话磁盘事件流,而非 PTY 输出标记

| 选项 | 选 / 不选 | 理由 |
|---|---|---|
| **A. `readSessionEdits`(会话 JSONL)** | ✅ | 每会话一个文件 = 归因天然按会话隔离;路径是 CLI 落盘真相(hashline 头/resolvedPath),无 TUI 渲染损耗;带精确 timestamp,迟到/重放可判 |
| B. 给 omp 加 `editMarks`(PTY 标记) | ❌ | 实证 omp TUI 卡片头路径强省略(`~/…`、`…` 截断),大量漏报;EditWatch 明确拒绝 `~` 路径;同幕布字节流无法区分并行写入者,PTY 侧无解 |
| C. 修 git 窗口仲裁(mtime 规则) | ❌ | mtime 只证明「何时被写」,不证明「谁写的」;重叠窗口下任何确定性规则都是猜。架构文档已记为已知歧义 |
| D. Rust 侧解析 omp 会话文件 | ❌ | 违反「内核不理解任何 CLI 私有格式」;JSONL 解析必须经 CLI 插件声明的适配器(沿 `readSessionUserMessages` 惯例) |

### D2 record_edit 增加 ts 守卫,而非只靠前端时序

前端链式(promptSent 先拉后锚)把竞态窗口压到毫秒级,但水位线重放、适配器慢读都可能在锚点落地后送来上一轮事件。`ts < anchor.ts → drop` 让错序事件在账本层零信任地被拒,PTY 标记(无 ts)不受影响。

### D3 已知边界(宁漏勿误,沿 claude 适配器同款纪律)

- 经 bash 落盘的变更(`git apply`/`sed -i`/`cargo fmt`)与 task 子代理(omp 子代理有独立会话文件)的写入不进本会话批次 —— 漏报自愈为「不进批」,绝无手改误混;
- 未声明信号的 CLI(kimi / qoder)仍走 git 窗口推断,其并行歧义维持架构文档已知记录;两者磁盘格式已具备事件形态(wire.jsonl `context.append_message.toolCalls` + time / claude 同构 `tool_use`),但本机无真实编辑样本可实证工具名与路径字段,接入随实证跟进,不猜格式。

## 验证

- 单测:四个适配器契约测试共 16 条(omp 7 / pi 4 / codex 2 / grok 3,夹带均实证自真实会话文件);`tests/events.rs` 新增「迟到事件早于锚点丢弃」;全量 vitest 绿、cargo test 绿(数目见门禁输出)
- 门禁:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build` 全绿;`cargo clippy --all-targets -- -D warnings` + `cargo fmt --check` 干净
- 真机目检:双 omp 会话并行编辑同仓文件,各自批次只含本会话 AI 写入;`/model` 轮零编辑不落批 —— 待用户复现场景回归(应用侧无 UI 自动化通道)
