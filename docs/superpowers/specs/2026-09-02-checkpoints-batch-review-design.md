# 批次审批/回退（checkpoints）设计文档

日期：2026-09-02
状态：设计已确认；评审修订 v5（UI 主形态 D，与 git 插件解耦，动作语义极简化，中央 = 批审阅单）
原型：`docs/prototypes/batch-review-D-panel.html`（**主形态**：右栏审批时间线 ×
中央 diff tab，用户选定，经两轮反馈收敛）
（探索稿 A/B/C 已删除，仅存 git 历史）

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
   CLI 直写工作区，改动实时归批。审批重点是发现"不需要的"：**通过 =
   什么都不做**（无保留按钮），**回退是唯一动作**；批次文件被提交或工作
   区内容偏离批次后像 → 自动「已处理」（默认通过）。
3. **与 git 插件零耦合**（评审修订）：不做保留→转暂存联动；暂存/提交是
   用户自己的 git 流程。
4. 铁律对齐：Rust 只做快照**原语**（不理解 CLI、不理解轮次）；批次生命周期
   与归因在特性插件；CLI 格式知识留在各 cli-\* 插件（本期仅预留接口）。

## 2. 关键决策

| 决策点 | 结论 | 理由 |
|---|---|---|
| 审批语义 | **事后审核 + 回退** | PTY 包壳无法在落盘前拦截；事前门控只对个别 CLI（permission hook）可行，列为非目标预留 |
| 批次定义 | **用户消息锚点切分** | 复用锚点栏基础设施（`readSessionUserMessages`）；批次 = 相邻两锚点快照的路径差集，快照与归因解耦，不依赖解析 CLI 工具调用流 |
| 快照机制 | **影子对象库** | sidecar 裸仓库只写 blob/tree 不建 commit，配 manifest；git2 已 vendored；Cline + OpenCode 双验证；不碰用户仓库 |
| 快照内容 | **变动集 + git 侧兜底**（见 §3.2） | 干净文件的前像永远是 git 侧（index/HEAD）内容，无需复制；快照成本 O(变动集) 而非 O(全树) |
| UI 主形态 | **D：右栏「审批时间线」× 中央 diff tab**（v3 修订） | 右栏（`registerFilePanel`）纯时间线列表，点文件在中央编辑区以 tab 打开 diff（`editorCenter.tabContent` 挂载点已有）——**零内核挂载点新增**；A/B/C 为探索稿 |
| 动作语义 | **极简（v3 修订）**：无「保留」按钮 | 审批重点是发现"不需要的"——通过=什么都不做；**回退是唯一动作**（对照参考）；批次文件被提交或工作区内容偏离批次后像 → 自动转「已处理」，无需操作 |
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

- `batchModel.ts`：批次状态机（v3 简化）`open → pending → reverted | done`；
  `pending` 是唯一可回退状态；`done` 全部自动触发——该批文件已提交
  （committed）或工作区内容偏离批次后像（changed：手改/后续批触碰），
  逐文件判定，全部失配才翻批态；单文件回退后批留在 pending，该文件行
  标记已退。监听 `kernel.sessions.prompt`（触发锚点快照 + seal 上一批）、
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

## 4. UI 设计（主形态 D v3：右栏时间线 × 中央 diff）

状态徽标色：进行中(open) accent 呼吸点、待审(pending) `#facc20`、
已退(reverted) `#a78bfa`、已处理(done) 中性灰（reason：已提交/内容已变）；
文件状态字母 chip 沿用 `--st-m/a/d/r/u/c` 体系。回退一律走确认 popover，
文案明示"回退前已自动打恢复点，可再回来"。

**右栏审批时间线**（`registerFilePanel` 注册独立面板，与 git 面板并列、
互不感知）：

- 纯时间线列表（无视图切换、**无筛选行**——v4 修订：状态徽标已挂在每个
  条目上，筛选 chips 在窄面板下换行溢出，砍掉；摘要行只保留待审计数）：
  批次倒序，点-线-徽标视觉语言；批次行 = 序号 + prompt 首行摘要 +
  文件数 ±stats + 状态徽标 + 时间；文件行**常驻展开**（无折叠）；
  resume 断档线（断档前批次只读）。
- 两个点击目标、一个去处：**批次行或文件行点击 → 中央开该批的「批审阅
  单」tab**（一批一个 tab；文件行 = 深链滚动到对应文件分区并高亮）。
  审阅单内容 = 用户消息全文卡（数据源即锚点栏基础设施
  `readSessionUserMessages` 的 `CliUserMessage.text`）+ "AI 修改的文件"
  分区列表（每分区 = 状态 chip + 路径 + ± + 单文件回退 + 着色 diff，
  默认展开、可折叠）。
- pending 批尾部「回退整批」+ 文件行 hover「只回退此文件」；reverted 批
  尾部「反悔 · 恢复回来」；done 批尾部说明缘由，无任何动作。
- 逐文件陈旧标记：文件当前内容 ≠ 批次后像 → 行内「内容已变」虚线 chip，
  不可回退（仍可看 diff 作对照）；全部文件失配 → 批自动转 done。

**中央编辑区「批审阅单」tab**（`editorCenter.tabContent` 挂载点，文件打开
的容器位置；v5 修订：不是会话原始详情，而是审批视角的合成页）：

- 一批一个 tab：tab 名 = `批次 #N`，带批次状态点；可开多个，可关闭；
  空态提示"从右侧审批线点批次或文件"。
- 工具条 = 批次上下文（#号 · 状态 · 缘由 · 时间 · ±stats）+「回退整批」
  （仅 pending）。
- 正文自上而下：**用户消息全文卡** → **"AI 修改的文件"分区列表**
  （每分区 = 状态 chip + 路径 + ± + 陈旧/已退标记 + hover「只回退此文件」
  + 着色 unified diff，默认展开可折叠；区间外折叠，完整渲染走 git 插件
  patch LRU 惯例）。时间线文件行点击深链到对应分区（滚动 + 高亮闪一下）。

探索稿 A（右栏列表）/ B（锚点栏批次卡）/ C（全屏回放台）保留在
prototypes 目录供后续演进参考。

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
- 自动已处理（v3 修订扩展）：状态轮询逐文件比对当前内容与批次后像——
  已提交（进入 git 历史/暂存）或内容偏离（手改/后续批触碰）即标记失配；
  全部文件失配 → 批自动转 done（默认通过），回退退役并提示缘由；
  不产生任何 git 侧写操作。
- sidecar 损坏：降级只读列表 + 提示重建（删除目录重新 baseline）。
- 磁盘不足：`checkpoint_prune` 紧急收缩（先 TTL 后条数）；仍不足则停止
  capture 并提示。
- resume 断档：会话 resume 后重打 baseline，历史批不跨 resume 追溯，
  UI 显示断档线（C 原型有示意）。

## 7. 测试策略

- Rust：capture/restore 往返（含新建文件删除式回退）、非 ASCII 路径、
  symlink/大文件跳过、XY 兜底推导（index/HEAD）、guard 快照链、prune、
  并发 capture 序列化（`parking_lot` 既有惯例）。
- TS：批次状态机（锚点→seal、时间窗降级、单文件回退、自动已处理
  committed/changed 判定）、事件契约（对齐现有 `*.test.ts` 惯例）。
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

## 实现修订（2026-09-03，已落地）

后端 `src-tauri/src/checkpoints/`（mod/capture/derive/diff/restore/commands/tests，
按文件规模铁则拆分；64 Rust 测试全绿）+ 前端 `src/plugins/checkpoints/`
（store/CheckpointsPanel/BatchSheet/batchTab/index）。与设计稿的差异：

- **promptSent 的 emit 归 composer 插件**（设计原写 host.writeSession 路径）：
  幕布击键同样走 `host.writeSession`，不能当 prompt；发送语义是 composer 的
  知识（`sendCurrent` / `sendFromDrawer` 两处漏斗），内核只持有 topic 常量
  `kernel.sessions.prompt`，payload `{sessionId, text(截断 400)}`。
- **快照内容增加 `baseOid`**（§3.2 未提）：anchor 时刻每个 dirty 路径记录
  index 侧 blob oid。前像解析顺序 = 工作区 blob(sidecar) → baseOid(用户仓库)
  → HEAD 兜底；避免"用户中途 commit 导致前像漂移"，done 批对照 diff 不失真。
- **done 判定精细化**：逐文件 `live` 分类（same 待审未动 / changed 内容已变 /
  committed 已入 git / reverted），全部 processed 才翻 done；内容相等但仍
  dirty = same（可回退），干净且相等 = committed。
- **守卫(guard)反悔按 revertedPaths 定向恢复**，不整树写回守卫快照。
- UI 落地：右栏面板经 `registerFilePanel`（order 10），中央审阅单经
  `editorCenter.tabContent`（一批一个 tab，id `ckpt-batch:<batchId>`）；
  FileTabContent 对非 file kind 让位返回 null（多 kind 并存前提）；
  `openTab` 增加 `{refresh:true}` 显式 opt-in 刷新 title/payload（缺省保持
  原去重不覆盖语义，tabs.test.ts 原断言不动）。
- 时间线 ± 行数来自批 diff 懒加载缓存（`loadDiff`，面板与审阅单共享）；
  open 批不展示 ±（无批后像）。
- prune 命令已实现，设置页入口未接（低频操作，v2 接入）。
