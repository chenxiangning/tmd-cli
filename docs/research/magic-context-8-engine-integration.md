# 8 引擎 Memory 治理集成设计 —— Magic Context 走法 B

日期:2026-09-05
状态:**已被取代** —— 首稿评审不通过(见 `docs/review/2026-09-05-memory-integration-design-review.md`),重新设计见 `docs/superpowers/specs/2026-09-05-memory-coordinator-design.md`;本文保留作调研底稿
作者:[INFERENCE] 由 AI 在 brainstorming 流程起草

---

## 0. 一句话决定

**不重写 memory,不魔改 Magic Context;在 tmd-cli 内核之外做一层 "memory coordinator 插件",对已支持的 3 家 CLI(omp / pi / opencode)走 Magic Context 直接装,对未支持的 5 家(claude / codex / grok / kimi / qoder×2)由 tmd-cli 自家写薄 adapter 写入同一 SQLite。**

核心原则:**Magic Context 是数据归宿,不是产品依赖;tmd-cli 插件是路由与适配层。**

---

## 1. 背景与目标

### 1.1 现状

- tmd-cli = Tauri2 + React 19 桌面应用,单窗口托管 8 个 AI CLI:`omp / pi / codex / claude / grok / kimi / qoder / qoder-cn`。
- 各 CLI session 已有 `src/plugins/cli-shared/` 知识读 JSONL(approval line / identity / title 等);**尚无跨 CLI 跨 session 的"项目级事实"层**。
- 当前唯一与"长期记忆"沾边的是 harness 内置的 `memory://`,仅供 agent 自身消费,不能跨 CLI 共享。

### 1.2 痛点

- 切换 CLI 时上下文重新丢失,**用户每次重复交代项目背景**。
- 单个 CLI 的 memory backend(如 omp 的 hindsight / mnemopi)各自为政,数据不互通。
- 缺乏污染治理:agent 主动写入的记忆**没有 dreamer / mental-model 级别的自动审查**。

### 1.3 目标(可验收)

| 编号 | 验收标准 |
| --- | --- |
| G1 | 在任意已支持 CLI 上跑一段会话后,切到另一家 CLI,**新会话首 turn 能见到上一家写下的相关事实** |
| G2 | 8 家 CLI 全部接入,无 1 家被排除;数据全在用户本机 |
| G3 | Magic Context 升级或损坏时,**tmd-cli 主功能(session / composer / approvals)不受影响** |
| G4 | **不修改任何现有 src/ 文件的语义行为**(只是新增插件与可选 hook) |
| G5 | 污染治理有现成机制(dreamer / mental-models),不靠人工 review |

### 1.4 非目标

- 不实现 memory 自身的语义检索 / 向量索引(交给 Magic Context + qmd)
- 不替换 harness 内置 `memory://`(按用户要求"不改变现有内置记忆的实现")
- 不引入新框架 / 新状态库 / 新 UI 组件库(对齐 AGENTS.md §3)
- 不实现 tauri 内任何 AI 调用(memory 治理走外部 CLI / SDK)

---

## 2. 方案取舍

### 2.1 候选方案对照(精简版)

| 方案 | 一句话 | 否决理由 |
| --- | --- | --- |
| A · 只装 3 家 | 简单,但 5 家掉队 | 违反 G2 |
| B · 走法 B(Magic Context + 自家 5 家 adapter) | 复用现成 + 补齐 | **采用** |
| C · 完全自造 | 无 cloud 依赖,但要重写 historian / dreamer | 违反"用现成不自己写"原则 |
| D · 全部外包给 Magic Context | 等 cortexkit 出 8 家 adapter | 不可控,违反 G2 |

### 2.2 走法 B 关键决策点

1. **集成深度选择**:只通过命令行 + 直接读 SQLite,**不 import `@cortexkit/*` SDK**
   - 理由:MIT 许可干净但产品路线不可控;不绑 SDK 升级时 Schema 变动风险小;SQLite 是通用接口
2. **数据归宿选择**:统一写 Magic Context 同款 SQLite(`~/.local/share/cortexkit/memory.sqlite` 或 `~/.cortexkit/...` 待 PoC 确认)
   - 理由:与已支持 3 家共享同一记忆池,跨 harness 检索能力直接可用
3. **5 家未支持 CLI 的写入策略**:**不调外部 CLI**(claude / codex 等没有 memory 后端),tmd-cli 自家 adapter 读它们的 session JSONL,提取事实写入 SQLite
   - 理由:这 5 家的"memory"概念若存在也是各自私有,绕开它们才能保 G3

### 2.3 不引入 Magic Context SDK 的代价

- **schema 探明成本**:要 PoC 跑一次才能定 SQLite 表结构(估计 1 人天)
- **失去类型提示**:读写 SQLite 自己包一层薄类型(预计 200 行 TS)
- **失去官方更新通知**:Magic Context 升级可能带 schema 迁移;需要自己写迁移脚本

**评估**:代价可控(< 2 人天),换来 G3 + 长期可控,值。

---

## 3. 架构:如何嵌入 tmd-cli

### 3.1 分层总览

```
┌──────────────────────────────────────────────────────────────────┐
│ tauri app-shell                                                  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ src/plugins/  (已有 17 插件)                              │   │
│  │   ...                                                     │   │
│  │   ├── welcome / workspace / composer / approvals ...     │   │
│  │   └── memory-coordinator/   ← NEW (§3.2 详)              │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ src/plugins/cli-shared/  (跨 CLI 共享知识)               │   │
│  │   approval / identity / title / ...                      │   │
│  │   + memory/   ← NEW (§3.3 详)                           │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ src/kernel/   (纯净逻辑层,无 IO / UI)                    │   │
│  │   + memory-protocol.ts  ← NEW (接口契约,§3.4)           │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
            │                                   │
            ▼                                   ▼
┌───────────────────────┐         ┌────────────────────────────────┐
│ Magic Context 外壳    │         │ 共享 SQLite                    │
│ (CLI wizard / daemon) │ ◀────▶ │ ~/.local/share/cortexkit/...   │
│ omp / pi / opencode   │         │ + tmd-cli 自家 adapter 补的表  │
└───────────────────────┘         └────────────────────────────────┘
```

### 3.2 新插件:`src/plugins/memory-coordinator/`

**定位**:memory 治理的"路由与编排",**不存数据**,只决定"哪条事实由谁写、写到哪、什么时机触发"。

**目录结构**(参照现有 `composer/` 插件结构):

```
src/plugins/memory-coordinator/
├── index.ts                       # 导出 Plugin,注册到 allPlugins
├── coordinator.ts                 # 核心调度(后台 worker 启停)
├── routes/
│   ├── omp.ts                     # 委托给 Magic Context(已支持)
│   ├── pi.ts                      # 同上
│   ├── opencode.ts                # 同上
│   ├── claude.ts                  # 自家 adapter(§4.1)
│   ├── codex.ts                   # 自家 adapter
│   ├── grok.ts                    # 自家 adapter
│   ├── kimi.ts                    # 自家 adapter
│   └── qoder.ts                   # qoder + qoder-cn 共用
├── adapters/                      # 自家 adapter 的事实抽取
│   ├── jsonl-reader.ts            # 复用 cli-shared 的 session 读取
│   ├── fact-extractor.ts          # 调 LLM 抽事实(走 CLI 自家模型)
│   └── schema-mapper.ts           # 映射到 Magic Context SQLite schema
├── settings/
│   ├── schema.ts                  # AppSettings 新增 memory 节
│   └── defaults.ts                # 默认配置 + sanitize 白名单
├── commands/
│   ├── setup.ts                   # 包装 Magic Context `npx ... setup`
│   ├── doctor.ts                  # 调 Magic Context doctor + 自检
│   ├── status.ts                  # 状态查询(供 UI 展示)
│   └── forget.ts                  # 包装 forget 流程
└── ui/
    └── MemoryPanel.tsx            # 右栏面板(记忆统计 / 治理状态 / 手动 forget)
```

**注册面**(经 ctx,符合 AGENTS.md §1):
- 后台 worker 启停钩子
- 设置面板新增「Memory 治理」分区
- 右栏面板挂载 `MemoryPanel`
- CLI 切换事件订阅(用于跨 CLI 触发 recall)
- 新 IPC 命令:`memory_setup`、`memory_recall`、`memory_forget`、`memory_status`

### 3.3 `src/plugins/cli-shared/memory/` 新增

按 AGENTS.md §1,**CLI 私有格式的跨插件共享沉淀进 `cli-shared/`**。Memory 抽取需要读各家 CLI 的 session JSONL,**这条知识天然属于 cli-shared**。

准入依据:**≥1 个 cli-* + feature 插件(memory-coordinator 是 feature 插件)联合消费**。

```
src/plugins/cli-shared/memory/
├── jsonl-reader.ts                # 通用 JSONL 流式读取(已存在?)
├── session-tail.ts                # session 增量监听(8 家格式归一)
├── identity-resolver.ts           # 复用 cli-shared/identity 的身份仲裁
└── README.md                      # 标注准入理由(AGENTS.md 要求)
```

文件头注释**必须**声明先例:
```ts
// 准入依据:memory-coordinator feature 插件消费 8 家 CLI session JSONL,
//          已有 17 个 cli-* 插件通过 cli-shared 共享身份/审批知识。
//          按 AGENTS.md §1 "feature 插件经它消费 CLI 格式须在 import 处注释声明"。
```

### 3.4 新内核契约:`src/kernel/memory-protocol.ts`

按 AGENTS.md §1 "内核准入 = 宿主机制与跨插件契约",**memory 协议属于跨插件契约,放 kernel**。

**接口定义**(纯类型,无实现):

```ts
// src/kernel/memory-protocol.ts
export type MemoryScope = 'project' | 'session' | 'global';
export type MemoryKind = 'fact' | 'preference' | 'decision' | 'lesson';

export interface MemoryItem {
  id: string;                      // Magic Context id 或自生成
  scope: MemoryScope;
  kind: MemoryKind;
  content: string;
  tags: string[];                  // 含 `project:<basename>` / `cli:<id>`
  cliSource?: string;              // 写入方 CLI id
  sessionId?: string;
  createdAt: number;               // unix ms
  confidence?: number;             // 0..1(Magic Context dreamer 用)
}

export interface MemoryBackend {
  retain(items: MemoryItem[]): Promise<void>;
  recall(query: string, opts?: { scope?: MemoryScope; limit?: number }): Promise<MemoryItem[]>;
  forget(id: string, opts?: { recoverable?: boolean }): Promise<{ recoveryId?: string }>;
  status(): Promise<{ count: number; backend: string; schemaVersion: number }>;
}

// 注册面:memory-coordinator 是唯一实现方,kernel 不内置实现
export type MemoryBackendFactory = () => MemoryBackend | null;
```

**kernel 文件硬约束**:**禁止出现 CLI 私有字符串 id**(`omp` / `claude-code` 等),仅出现通用类型。

### 3.5 复用现有 cli-shared 知识

| 已有 cli-shared 能力 | memory-coordinator 复用方式 |
| --- | --- |
| session JSONL 读取(各家适配器) | `identity-resolver.ts` 直接调,不重写 |
| identity.ts 内容证据仲裁 | 用于事实归属(谁说的) |
| diskSessions 标题提取 | 复用 `extractJsonlTitle` 思路,做摘要回写 |

**原则**:**优先复用,禁造第二套**。cli-shared 已有就调;没有才进 cli-shared/memory/ 新增。

---

## 4. 5 家未支持 CLI 的 adapter 设计

### 4.1 设计原则

1. **不调外部 CLI**(claude / codex 等没有 memory 后端,**绕开它们**)
2. **复用 cli-shared 的 session 读取**,只新增"事实抽取"层
3. **抽取模型复用现有 model role**(`tiny` role 适合,见 `docs/research/omp-cli-course/README.md` §"模型 role 表")
4. **写入 SQLite 走 schema-mapper**,不直接拼 SQL

### 4.2 单个 adapter 的标准流程

以 `routes/claude.ts` 为例,其余 4 家同构:

```text
[Claude Code session 关闭]
  ↓ (通过 cli-shared/memory/session-tail.ts 监听)
[jsonl-reader 拿到增量 N 条消息]
  ↓
[fact-extractor.ts: 调 tiny role 模型,提示词]
  "从以下对话中提取值得长期记住的事实…
   仅提取:用户偏好 / 项目决策 / 教训 / 持久约束
   排除:一次性请求 / 临时调试 / 闲聊"
  ↓ (得到 [{content, kind, tags}, ...])
[schema-mapper.ts: 转 Magic Context SQLite 行]
  写入 ~/.local/share/cortexkit/memory.sqlite
  tags = ['project:<basename>', 'cli:claude-code', ...]
  ↓
[返回 retain 计数给 coordinator;失败入 retry queue]
```

### 4.3 各家差异处理

| CLI | session JSONL 位置 | 抽取触发时机 | 已知风险 |
| --- | --- | --- | --- |
| **claude-code** | `~/.claude/projects/*/sessions/*.jsonl` | session close hook + 定期扫描 | token 大,需流式 |
| **codex** | `~/.codex/sessions/**/*.jsonl` | 同上 | 格式与 claude 类似,可共用 reader |
| **grok** | `~/.grok-cli/sessions/...`(待 PoC 确认) | 同上 | 文档少,先 spy 再写 |
| **kimi** | 待 PoC | 同上 | 同 grok |
| **qoder / qoder-cn** | 待 PoC | 同上 | 同族变体,glyph 共用 adapter |

**风险处理**:**先 PoC 验证各 session JSONL 实际位置和格式,再写代码**。没有事实先写代码 = 造 bug。

### 4.4 失败与降级

- **SQLite 写失败**:retry queue(MemoryItem 暂存本地 JSONL),下次启动重试
- **模型抽 fact 失败**:跳过本轮,不污染库
- **Magic Context 进程不在**:coordinator 仍保留"读"能力,仅禁用"写"提示;**保证 G3**

---

## 5. 路由与编排策略

### 5.1 何时写(retain)

| 触发源 | 优先级 | 说明 |
| --- | --- | --- |
| 已支持 CLI 主动 retain(model 调 tool) | 高 | 走 Magic Context,我们只观察 |
| 自家 adapter 检测到 session close | 中 | 抽 fact 后批量写 |
| 用户手动 `/remember` 类操作 | 中 | UI 触发 |
| 心跳式定期 consolidate | 低 | Magic Context dreamer 自带 |

### 5.2 何时读(recall)

| 触发源 | 优先级 | 注入方式 |
| --- | --- | --- |
| 新 session 首 turn | **必** | 经 kernel 注入 system prompt(走 magic-context 风格 mental-models) |
| 用户在 UI 面板手动搜 | 中 | IPC 直查 |
| 切换 CLI 时 | 低 | 弹一次性提示,不自动注入 |

### 5.3 KV cache 稳定性(对照 pi-memory)

tmd-cli 已有 CLI session 切换,**不能让 memory 注入破坏 xterm 回放**(MEMORY.md 里"xterm 回放须过 terminalInputGate 计数门")。

- memory 注入走 kernel 的 **prompt 拼装层**,**不进入 PTY bytes 流**
- mental-models 摘要**字节级缓存**在 memory-coordinator 内部(参考 pi-memory 的 `stable` snapshot)
- 已写不触发 KV cache bust,与 omp 自身的 mental-models 设计思路一致

---

## 6. tmd-cli 大改 vs 小改评估

### 6.1 改动清单

| 类型 | 文件 / 位置 | 性质 |
| --- | --- | --- |
| 新增插件 | `src/plugins/memory-coordinator/` 全目录 | **纯新增** |
| 新增 cli-shared | `src/plugins/cli-shared/memory/` 全目录 | **纯新增** |
| 新增 kernel 契约 | `src/kernel/memory-protocol.ts` | **纯新增** |
| 注册到 allPlugins | `src/plugins/index.ts` | **加一行** |
| AppSettings 新增 | `src/kernel/settings.ts`(已有)+ `src/plugins/memory-coordinator/settings/schema.ts` | **新增分区**,默认空 |
| prompt 拼装层 hook | `src/kernel/prompt.ts`(待 PoC 定位) | **新增一处插入**,不破坏现有行为 |
| 设置 UI | 已有 settings 面板加分区 | **新增分区** |

### 6.2 大改评估

- **不修改任何现有插件语义行为** —— 仅 `allPlugins` 多一行、`AppSettings` 多一节
- **kernel/prompt.ts 的插入是可选 hook**,默认关闭时与现行为字节一致
- **不引入新框架 / 新状态库** —— 用现有 React + Tailwind + 现有 IPC
- **不修改 Rust 侧** —— memory 走文件系统 + 外部 CLI,**不新增 Tauri command 也行**;非要加 IPC 走 `src/kernel/ipc.ts` 一处(符合 R3)

### 6.3 风险点(必须披露)

1. **Magic Context schema 未公开**:PoC 跑出来才能定表结构;**PoC 不过则降级到走法 C(自家 SQLite)**
2. **5 家 CLI session JSONL 格式未全部探明**:claude-code / codex 已知,grok / kimi / qoder 待 PoC
3. **fact-extractor 的 LLM 调用**:必须用便宜模型(`tiny` role),否则 token 成本爆炸
4. **mental-models 注入与现有 prompt 拼装耦合**:需要 kernel 层做"可选插入",不能强行注入

---

## 7. 使用方式(用户体验)

### 7.1 首次安装

```bash
# tmd-cli 启动后,settings → Memory 治理
# 自动检测 Magic Context 是否已装;未装则:
pnpm tauri:dev
# settings UI 点击 [一键启用 Memory 治理]
# → 弹 confirm → 后台跑
npx @cortexkit/magic-context@latest setup --harness omp
npx @cortexkit/magic-context@latest setup --harness pi
npx @cortexkit/magic-context@latest setup --harness opencode
# → tmd-cli 自动检测 SQLite 就位,启用 coordinator
```

### 7.2 日常使用

```
用户: "这个项目用 bun 不用 npm"
Claude Code session:
  → session close 时,adapter 抽取 fact
  → 写入 SQLite, tags = ['project:tmd-cli', 'cli:claude-code']
OMP session 启动:
  → 首 turn 自动 recall "bun"
  → 注入 mental-models 摘要:"项目包管理 = bun"
  → agent 不需要用户重复交代
```

### 7.3 治理操作

| 操作 | UI 入口 | 实际命令 |
| --- | --- | --- |
| 查状态 | 右栏 MemoryPanel | `memory.status()` |
| 手动搜 | MemoryPanel 搜索框 | `memory.recall(query)` |
| 手动忘 | 列表项右侧 ✕ | `memory.forget(id, {recoverable: true})` |
| 跑 dreamer | 面板 [Consolidate] | `npx @cortexkit/magic-context dream` |
| 诊断 | settings → Memory → [Doctor] | `npx ... doctor` |
| 关闭 | settings → Memory → [禁用] | 卸装,SQLite 保留 |

### 7.4 失败兜底

- SQLite 损坏 → 面板红条提示,**不阻塞主功能**(G3)
- Magic Context 进程挂了 → coordinator 切"只读模式",写入进 retry queue
- 5 家 adapter 某家 bug → 单家 disable,**不影响其他 7 家**

---

## 8. 验证

### 8.1 PoC 阶段(进 spec 前必跑)

| 编号 | 验证项 | 通过判据 |
| --- | --- | --- |
| PoC-1 | Magic Context SQLite schema 可识别 | 能列出所有表 + 列;能读 sample 行 |
| PoC-2 | omp harness 装好 Magic Context 后能正常 retain / recall | 写一条 fact,5min 后 recall 命中 |
| PoC-3 | tmd-cli 自家 adapter 写一条到 SQLite,OMP 能 recall | 跨 harness 检索成功 |
| PoC-4 | claude-code session JSONL 实际位置与格式确认 | 能列出文件并解析 N 条消息 |
| PoC-5 | grok / kimi / qoder session 路径可定位 | 至少能 ls |

**PoC 任何一项不过**,本设计需降级或修订(转 spec 时披露)。

### 8.2 落地阶段门禁

按 AGENTS.md §2:
- 前端改动:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`
- 新建插件须 < 500 行 / 文件;超 500 加 `file-size-exempt` 头
- UI 改动:`pnpm tauri:dev` 真窗目检 MemoryPanel 四态(空 / 加载 / 有数据 / 故障)
- 跑 `pnpm check:arch-boundary` 验证 R1/R3/R4 不破坏

### 8.3 端到端验证脚本

```bash
# /tmp/memory-e2e.sh(临时,不落仓)
1. 清空 SQLite
2. 起 omp 会话,输入 "用 bun 不用 npm"
3. 关会话
4. 起 claude-code 会话,问 "用什么包管理器"
5. 期望:首 turn 看到 "用 bun 不用 npm" 的 fact
```

### 8.4 抗污染验证

- dreamer 跑 N 次后,SQLite 中**重复 fact 应自动合并**(Mem0/Magic Context 自带)
- 验证:`memory.status().count` 在 100 次重复输入后增长应 < 5
- 手动 forget 后 recall 不再命中

---

## 9. 不做 / 待定

- **多用户 / 团队共享 memory**:Hindsight 才有,tmd-cli 默认单用户;**本期不做**
- **memory 与 checkpoint 联动**:checkpoint 已有独立机制;**本期不交叉**
- **UI 自动注入 mental-models**:PoC 后再决定是否开启,默认仅手动 recall
- **隐私 / 加密**:本地 SQLite 明文,**遵守 Magic Context 默认行为**;本地敏感项目用户自行加密文件系统

---

## 10. 决策日志

| 日期 | 决定 | 理由 |
| --- | --- | --- |
| 2026-09-05 | 走法 B | 用户"用现成" + G2 全覆盖 |
| 2026-09-05 | 不 import SDK,只走 CLI + 直读 SQLite | 解耦,降升级风险 |
| 2026-09-05 | 不改任何现有 src/ 语义 | 保持小改面,符合 AGENTS.md §1 |
| 2026-09-05 | 5 家 adapter 走自家抽取 + schema-mapper | Magic Context 不覆盖 |
| 待 PoC | 是否降级到走法 C | PoC-1 不过即降级 |