# 批次审批/回退（checkpoints）设计文档

日期：2026-09-02
状态：设计已确认；评审修订 v2（UI 主形态定为 D，与 git 插件解耦）
原型：`docs/prototypes/batch-review-D-panel.html`（**主形态**：右栏审批时间线，C 稿时间线布局 × 右栏面板宿主，用户选定）
　　　`docs/prototypes/batch-review-A-timeline.html` / `B-anchor.html` / `C-replay.html`（探索稿：右栏列表 / 锚点卡 / 全屏回放台）

## 1. 背景与目标

tmd-cli 是多 CLI 桌面壳：一轮对话里 CLI 常批量改一批文件，而壳层目前只有
git 插件看"最终状态"，回答不了"这一轮改了什么、能不能整批退回"。

调研结论（2026-09-02，详见对话记录）：Claude Code（checkpoints/rewind）、
Gemini CLI（/checkpoint · /restore）、Cline/Roo（shadow git）、OpenCode
（内部 git 对象库快照）都已收敛到 checkpoint 范式；Codex CLI 与 Crush 核心
没有；pi 核心没有但扩展生态补齐（arpagon/pi-rewind 等，全部 shadow git/stash
路线）；omp 只有官方示例 hook（`git stash create` 40 行版）。

目标：

1. 壳层跨 CLI 统一提供**批次**（= 一条用户消息之后到下一条之前的所有文件
   改动）的审核能力：看 diff、保留、按文件/整批回退。
2. 审批线 = 盖在工作区之上的**台账 + 安全网**，不是 git 前缓冲队列：PTY
   CLI 直写工作区，改动实时归批；「保留」= 认可（从待审队列移除），
   「回退」= 把该批路径还原到这轮消息之前。
3. **与 git 插件零耦合**（评审修订）：不做保留→转暂存联动；暂存/提交是
   用户自己的 git 流程。用户抢先 commit 了某批文件 → 该批自动转「已留
   （已提交）」，回退入口退役——回退已提交历史是 `git revert` 的职责。
4. 铁律对齐：Rust 只做快照**原语**（不理解 CLI、不理解轮次）；批次生命周期
   与归因在特性插件；CLI 格式知识留在各 cli-\* 插件（本期仅预留接口）。

## 2. 关键决策

| 决策点 | 结论 | 理由 |
|---|---|---|
| 审批语义 | **事后审核 + 回退** | PTY 包壳无法在落盘前拦截；事前门控只对个别 CLI（permission hook）可行，列为非目标预留 |
| 批次定义 | **用户消息锚点切分** | 复用锚点栏基础设施（`readSessionUserMessages`）；批次 = 相邻两锚点快照的路径差集，快照与归因解耦，不依赖解析 CLI 工具调用流 |
| 快照机制 | **影子对象库** | sidecar 裸仓库只写 blob/tree 不建 commit，配 manifest；git2 已 vendored；Cline + OpenCode 双验证；不碰用户仓库 |
| 快照内容 | **变动集 + git 侧兜底**（见 §3.2） | 干净文件的前像永远是 git 侧（index/HEAD）内容，无需复制；快照成本 O(变动集) 而非 O(全树) |
| UI 主形态 | **D：右栏「审批时间线」面板**（评审修订，用户选定） | C 稿时间线布局 × 右栏面板宿主；时间线（默认）↔ 批次详情（点开看 diff）双视图；A/B/C 为探索稿 |
| MVP 工作区 | 仅 git 工作区 | status 增量 + ignore 规则免费；非 git 目录灰掉说明（v2 用 fs 扫描降级） |

## 3. 架构与数据流

```
用户发送 prompt ──► kernel session_write
                      │ emit kernel.sessions.prompt {sessionId}     (新 topic)
                      ▼
        checkpoints 插件: invoke checkpoint_capture ──► sidecar 裸仓库
                      │   (锚点快照: 变动集 blob + git XY 码)          {configHome}
                      ▼                                                    │
CLI 在 PTY 里改文件;插件轮询 git_status 原语,增量路径归到 open 批次        │ objects/
                      │                                                    │ manifests.jsonl
下一条 prompt ──► 新锚点快照;上一批 seal(diff=两锚点差集)                  │
                      ▼                                                    │
        UI 三形态共享 batchStore ◄── checkpoints://batch-updated ──┘
        (A filePanel tab / B 锚点卡 / C overlay)
                      │ 「保留」                 │ 「回退」
                      ▼                          ▼
          emit git://stage-paths      restore-guard 快照 → 按路径写回
          (git 插件批量暂存)           → emit batch-updated(state=reverted)
```

### 3.1 分层与组件

**Rust 原语层 `src-tauri/src/checkpoints/`**（与 `git/` 模块平级；不合并——
git 模块语义 = 用户仓库操作且有 commit 安全不变量，checkpoints 是独立存储域）：

- `store.rs`：`{configHome}/checkpoints/{workspaceHash}/` 初始化裸仓库
  （git2 `init_bare`）+ `manifests.jsonl` 追加写。blob 经 odb 写入，同内容
  自动去重；**永不建 commit/ref，永不触碰用户仓库**。workspaceHash 沿用
  `hash.rs` 既有工具（与 kimi 会话目录 md5(cwd) 同惯例）。
- `diff.rs`：blob↔blob 行级 patch（内存 odb，git2 diff）；批次 diff =
  前像集 ∪ 后像集 逐路径比对。
- `restore.rs`：事务化还原（guard 快照 → 写回 → 记 `restoredFrom`）。
- `commands.rs`：Tauri 命令（前端 `kernel/ipc.ts` 加类型化包装）：

| 命令 | 语义 |
|---|---|
| `checkpoint_capture(cwd, sessionId, anchor?)` | 锚点快照，返回 SnapshotId |
| `checkpoint_list(cwd, sessionId?)` | 快照清单（元数据；批次的审核态在插件侧 batchStore，Rust 不感知） |
| `checkpoint_batch_diff(cwd, batchId)` | 该批逐文件 patch |
| `checkpoint_restore(cwd, batchId, paths?)` | 回退整批或子集；返回 `{restored, deleted, skipped}` |
| `checkpoint_prune(cwd, keepPerSession, ttlDays)` | 保留策略清理 |

**特性插件 `src/plugins/checkpoints/`**：

- `batchModel.ts`：批次状态机 `open → sealed → kept | reverted | partial`；
  监听 `kernel.sessions.prompt`（触发锚点快照 + seal 上一批）、
  `activeSessionChanged`（baseline 快照）、`sessionExited`（seal 收尾）。
- `attribution.ts`：轮询 `git_status` 原语（invoke 原语不构成插件间依赖），
  增量路径归入 open 批次；无锚点数据（CLI 未实现 `readSessionUserMessages`）
  退化为时间窗批次（30s 静默闭批，UI 标注"时间窗"）。
- `batchStore.ts`：审批时间线面板（及未来形态）共享的状态store（对齐 git
  插件 `panelStore.ts` 惯例）；
  变更经 `checkpoints://batch-updated {batchId, sessionId, state, filesDelta}` 广播。
- `checkpointsEvents.ts`：事件契约（本插件 emit/消费的唯一 topic 即上者；
  **不定义任何指向 git 插件的 topic**——评审修订，两插件互不感知）。

### 3.2 快照内容语义（精确到路径）

锚点快照不复制全树，只记录**变动集**：

1. `git_status` 列出的每个非 ignore 变动路径：读工作区文件（symlink、
   >2MiB、二进制跳过并标记）→ `odb.write_blob` → manifest 记
   `{path → blobOid}`；
2. 同时刻的 git XY 状态码快照 `{path → " M" 等}`。

**前像推导**（回退/求 diff 时按路径）：锚点快照存了 blob → 用 blob；
没存（该路径锚点时刻干净）→ 该文件当时内容即 git 侧：XY 显示仅工作区改动
→ index 版本，否则 → HEAD 版本。推论成立的原因：干净文件的工作区内容
就等于 git 侧内容。由此锚点快照成本 = O(变动集)，大仓库无压力。

新建文件回退 = 删除（前像不存在）；批次 diff 的"后像"：sealed 批取下一
锚点快照，open 批取当前工作区。

### 3.3 内核契约扩展（`src/kernel/`）

- `events.ts`：`KernelTopics` 新增 `promptSent: "kernel.sessions.prompt"`，
  payload `{sessionId}`。这是唯一新增的内核行为——"何时发送"本就是内核
  事实（`session_write` 路径 emit）。
- ~~`plugin.ts` MountPoint 新增 `anchorRail.card`~~：B 形态挂载依据，
  **评审修订：移出本期范围**（主形态定为 D，filePanel 注册点已有）。
- `cli.ts`：`CliProfile` 预留可选 `readSessionFileEdits?(cwd, sessionId)` →
  轮→文件归因表。有它归因更准（连 bash 造成的改动都能按轮归属）；
  **MVP 不实现任何 cli-\* 适配**，接口先立住。

## 4. UI 设计（主形态 D，评审修订）

状态徽标色：进行中(open) accent 呼吸点、未审(sealed) `#facc20`、已留(kept)
`#4ade80`、已退(reverted) `#a78bfa`、已提交自动已留(committed) 中性灰；
文件状态字母 chip 沿用 `--st-m/a/d/r/u/c` 体系。回退一律走确认 popover，
文案明示"回退前已自动打恢复点，可再回来"。

**D 右栏「审批时间线」面板**（`registerFilePanel` 注册独立面板，与 git
面板并列、互不感知）：

- 时间线视图（默认）：批次倒序，点-线-徽标视觉语言（继承 C 稿）；
  批次行 = 序号 + prompt 摘要 + 文件数 ±stats + 状态徽标 + 时间；
  顶部状态筛选 chips；resume 断档线（断档前批次只读）。
- 批次详情视图（点击进入，← 返回）：prompt 全文 + 对照基准（进行中批对
  当前工作区，封口批对批次结束时点）；文件组折叠列表，点开即行级 diff；
  pending 批文件行 hover 出「只回退此文件」。
- 动作语义（与 git 解耦后）：**保留** = 认可，改动本就在工作区，暂存/
  提交由用户自行完成（toast 文案明示）；**回退整批/单文件** = 还原到该轮
  消息之前；reverted 批详情底部有「反悔 · 恢复回来」（恢复点回放）。
- committed 批：显示"文件已随你的提交进入 git · 本批自动已留"，无回退
  动作（属 `git revert` 职责）。

探索稿 A（右栏列表）/ B（锚点栏批次卡，需 `anchorRail.card` 挂载点）/
C（全屏回放台，Esc Esc）保留在 prototypes 目录供后续演进参考；B/C 涉及
的内核挂载点（`anchorRail.card`）从本期范围移除。

## 5. 文件改动清单

| 文件 | 改动 |
|---|---|
| `src-tauri/src/checkpoints/{mod,store,diff,restore,error}.rs` | 新模块：裸仓库、快照、diff、事务还原 |
| `src-tauri/src/checkpoints/tests.rs` + `tests_common.rs` | 往返/边界/并发用例 |
| `src-tauri/src/lib.rs` | 注册 5 个 `checkpoint_*` 命令 |
| `src/kernel/ipc.ts` | 命令的类型化包装 |
| `src/kernel/events.ts` | +`promptSent` topic |
| `src/kernel/cli.ts` | +可选 `readSessionFileEdits`（仅接口） |
| `src/kernel/host.ts` | 发送路径 emit `promptSent` |
| `src/plugins/checkpoints/*` | 新插件：batchModel/attribution/batchStore/审批时间线面板（D） |
| `src/plugins/index.ts` | 注册 `checkpoints` |

## 6. 错误处理

- 锚点快照失败不阻塞发送：后台重试一次，仍失败标 `partial` 并在 UI 提示。
- 回退冲突：当前文件内容 ≠ 该批后像（用户手改过）→ 进 `skipped[]` 显式
  列出，**绝不静默覆盖**。
- 用户抢先提交（评审修订新增）：批次文件被用户 commit/stage 后，状态轮询
  发现该路径已进入 git 历史/暂存 → 该批自动转「已留（已提交）」，回退
  入口退役并提示缘由；不产生任何 git 侧写操作。
- sidecar 损坏：降级只读列表 + 提示重建（删除目录重新 baseline）。
- 磁盘不足：`checkpoint_prune` 紧急收缩（先 TTL 后条数）；仍不足则停止
  capture 并提示。
- resume 断档：会话 resume 后重打 baseline，历史批不跨 resume 追溯，
  UI 显示断档线（C 原型有示意）。

## 7. 测试策略

- Rust：capture/restore 往返（含新建文件删除式回退）、非 ASCII 路径、
  symlink/大文件跳过、XY 兜底推导（index/HEAD）、guard 快照链、prune、
  并发 capture 序列化（`parking_lot` 既有惯例）。
- TS：批次状态机（锚点→seal、时间窗降级、partial、用户抢先提交→自动
  已留）、事件契约（对齐现有 `*.test.ts` 惯例）。
- 手动 smoke：`pnpm dev` → omp 会话连发两轮改文件 → A 面板出两批 →
  回退第二批 → 编辑器确认文件回滚 → guard 再回退一次回到改后状态。

## 8. 非目标（YAGNI）

- 事前门控（edit 前拦截）——仅在未来为支持 permission hook 的 CLI 预留。
- 与 git 插件的一切联动（转暂存/提交/推送）——审批线只对工作区做
  读与还原，git 流程完全归用户与 git 插件。
- 对话回退：PTY CLI 无法从中间重放；以「复制 prompt 重新出发」补偿。
- 非 git 工作区支持（v2 fs 扫描降级）。
- hunk 级部分回退（文件粒度已覆盖 90% 场景）。
- 跨 resume 的历史批追溯。
