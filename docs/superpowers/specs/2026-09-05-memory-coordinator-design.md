# Memory Coordinator 设计 —— Magic Context 记忆池 + 双通路注入(8 引擎)

日期:2026-09-05
状态:**已批准(2026-09-05 用户通过)** —— 实施前置 PoC,变更契约见 `openspec/changes/memory-coordinator/`;UI 定稿决策见 §8(评审后设计对话演进);取代 `docs/research/magic-context-8-engine-integration.md` 草案,评审记录见 `docs/review/2026-09-05-memory-integration-design-review.md`;交互原型 `docs/design/memory-capsule-demo.html`

---

## 1. 背景与目标

### 1.1 现状

- tmd-cli 单窗口托管 8 个 AI CLI 插件:cli-omp / cli-pi / cli-codex / cli-claude / cli-grok / cli-kimi / cli-qoder / cli-qoder-cn。
- 各家 session JSONL 读取知识已在 `src/plugins/cli-shared/`(qoderSessions / piFamily / quota/codexLocal 等,路径真值实证)。
- 无跨 CLI 的项目级记忆层:用户在 A CLI 交代过的偏好/决策,B CLI 一无所知。
- 现成方案调研(`docs/research/magic-context-8-engine-integration.md`):Magic Context(MIT,2029 star)原生覆盖 OpenCode / Pi / OMP 三 harness,共享本地 SQLite 记忆池,自带 historian(提取)/ dreamer(治理)/ 注入;其余 5 家无官方支持。

### 1.2 设计铁前提(评审 P0 结论,不可违背)

1. **tmd-cli 是 PTY 宿主,不是模型调用方** —— 不存在 prompt 拼装层;一切注入必须发生在幕布之外(PTY bytes 流之外)。
2. **tmd-cli 内(含 Rust/TS)不做 AI 调用** —— 事实抽取只能复用 Magic Context 自身管线或外部子进程。
3. **webview JS 不能直读文件** —— 访问 SQLite 必须走 Rust 原语或子进程,「零 Rust 改动」不成立,如实计入改动面。

### 1.3 分期目标

| 期 | 覆盖 | 验收 |
| --- | --- | --- |
| **Phase 1** | **8 家全部可读,3 家(omp/pi/opencode)可写** | 在 omp 会话沉淀的项目事实,claude/codex/grok/kimi/qoder 新会话可一键带出;Magic Context 故障时主功能零影响 |
| **Phase 2** | 5 家可写 | claude 等 5 家 session 关闭后,其沉淀入同一池,omp 侧可 recall;写入路线 **d(借道 omp 会话代写)已选定**(PoC-2 实证,见 §2.2 与 PoC 报告) |

非目标:不自造向量检索/治理(用 Magic Context 的);不动 harness 内置 `memory://`;不引入新框架/状态库;Phase 1 不写用户仓库内任何文件。

---

## 2. 方案取舍

### 2.1 总形态(选定)

**Magic Context 是唯一记忆池;tmd-cli 新增 memory-coordinator 插件做编排;读注入分双通路;写提取分期。**

```
                 ┌────────────────────────────────────────────┐
                 │  Magic Context(外部,MIT)                  │
                 │  historian 提取 / dreamer 治理 / embedding  │
                 └───────────────┬────────────────────────────┘
                                 │ 共享 SQLite(本地)
        ┌────────────────────────┼─────────────────────────────┐
        │ 3 家原生插件(omp/pi/   │  tmd-cli memory-coordinator │
        │ opencode):自读自写     │  插件:编排 + 5 家通路       │
        └────────────────────────┼─────────────────────────────┘
                                 │
              读通路 A(3 家)     │        读通路 B(5 家)
              Magic Context 注入  │        composer「记忆胶囊」
              tmd-cli 零参与      │        (幕布外,用户触发)
                                 │
              写通路(Phase 2,5 家):session JSONL → 外部入口入池
```

### 2.2 关键取舍

| 决策点 | 选定 | 被否决 | 理由对照 |
| --- | --- | --- | --- |
| 5 家读注入 | **composer 记忆胶囊**:新建 5 家会话时,composer 显示「项目记忆」胶囊,点开注入为消息前缀(经用户确认发送);设置可改自动 | 写项目 context file(CLAUDE.md/AGENTS.md 受管区块) | 否决因:**污染用户 git status**(往已跟踪文件写区块 = diff 噪音);用户级文件又会跨项目泄漏。胶囊经 PTY 即用户输入,零文件污染,符合「增强发生在幕布外」铁律 |
| SQLite 访问 | **新增 Rust 只读原语 `sqlite_query`**(`src-tauri/src/lib.rs` 一处 + `src/kernel/ipc.ts` 注册,符合 R3) | proc_communicate 跑 sqlite3 CLI | 否决因:依赖用户机器装 sqlite3 + SQL 转义面大;只读原语 60 行内,快且稳 |
| 5 家写入路线(Phase 2) | **d · 借道 omp 会话代写(2026-09-05 PoC-2 选定)**:proc_communicate 跑 `omp -p "记住:…"`,omp 模型调 `ctx_memory(action="write")`,权威/epoch/FTS 全走官方管线;成本一次小模型调用。c(面板手动)保留为兜底 | a · 官方 CLI/RPC 写入(PoC-2 实证**不存在**);b · 外部脚本直写 SQL(否决:`project_memory_epoch` 缓存失效协议 + `authority_managed` 门控 + schema 无稳定性承诺);tauri 内直调 LLM(违背前提 2) |
| 记忆协议位置 | `src/plugins/memory-coordinator/protocol.ts` | `src/kernel/memory-protocol.ts` | 否决因:AGENTS.md「单插件语义不入 kernel」——当前唯一实现+消费方都是本插件;出现第二个消费者再上提 |
| 直写 Magic Context SQLite | 不做写入,只读 | tmd-cli 拼 INSERT 写池 | 否决因:recall 走 embedding,绕过其 embed 管线的裸行可能永不命中;schema 未公开,升级即碎 |
| 方案整体 | Magic Context 池 + 编排插件 | 全自造(走法 C)/ 等官方 5 家 adapter(走法 D) | C 违背「用现成」且要重写 historian/dreamer;D 不可控、无期限 |

### 2.3 代价如实声明

- 要改 Rust(一个只读原语)——「零 Rust 改动」不承诺。
- Phase 1 里 5 家会话的内容不会自动进池(单向:池 → 5 家)。这是换取「无 AI 调用、无 schema 耦合、无文件污染」的分期代价。
- Magic Context setup 会禁用 omp/pi 原生 compaction 与 automatic memory(其工作前提),已有 mnemopi/hindsight 配置的用户会被覆盖——安装流必须先检测、显式告知(§5.1)。

---

## 3. 架构设计

### 3.1 新插件 `src/plugins/memory-coordinator/`

```
src/plugins/memory-coordinator/
├── index.tsx              # Plugin 注册入口(allPlugins +1 行)
├── protocol.ts            # 记忆契约(本插件内;第二个消费者出现再议上提 kernel)
├── pool.ts                # 池访问:经 ipc.sqliteQuery 只读 recall/status
├── capsule/               # 读通路 B:composer 记忆胶囊
│   ├── MemoryCapsule.tsx  # composer 挂点组件(项目记忆摘要胶囊)
│   └── inject.ts          # 胶囊展开 → 消息前缀拼装(幂等)
├── install/               # 安装编排(3 家 Magic Context setup 的检测/预览/执行)
│   ├── detect.ts          # node/npx 可用性、已装检测、既有 backend 冲突检测
│   └── setup.ts           # 经 proc_communicate 跑 npx setup,收集 diff 预览
├── phase2/                # 5 家写提取(Phase 2,骨架占位不做实现)
├── settings/              # AppSettings.memory 节(commit/sanitize/默认值断言)
└── panel/
    └── MemoryPanel.tsx    # 右栏面板:状态/搜索/手动 forget/跑 dreamer
```

- **扁平结构**,对齐现有 cli-* 插件惯例(index + 领域文件),不用 routes/ 层级。
- 注册面全部经 `activate(ctx)`:composer 挂点、右栏面板(既有 subbar 注册机制)、设置分区(既有 `src/kernel/settingsRegistry.ts`)、session 生命周期订阅。

### 3.2 protocol.ts(契约,插件内)

```ts
export type MemoryScope = 'project' | 'global';
export type MemoryKind = 'fact' | 'preference' | 'decision' | 'lesson';

export interface MemoryItem {
  id: string;
  scope: MemoryScope;
  kind: MemoryKind;
  content: string;
  tags: string[];          // project:<basename> / cli:<id>
  createdAt: number;
}

export interface MemoryPool {
  recall(query: string, opts?: { limit?: number }): Promise<MemoryItem[]>;
  status(): Promise<{ ready: boolean; count: number; dbPath: string | null }>;
  // 写入仅 Phase 2 经外部入口,不经本接口直写库
}
```

### 3.3 读通路 B:记忆胶囊(Phase 1 核心)

触发:5 家(cli-claude/codex/grok/kimi/qoder×2)新会话创建时,coordinator 查池(当前 workspace 的 project 标签),命中则在 composer 顶部渲染「项目记忆 N 条」胶囊。

行为:
- 默认**手动**:点击展开摘要(分类:偏好/决策/教训),再点「注入」拼为消息前缀,经 composer 正常发送通道进 PTY —— 即用户输入,不碰透传。
- 设置 `memory.capsule.autoInject` 可开自动(展开即前缀,仍走 composer 发送)。
- 池不可用/查询失败:胶囊不渲染,零打扰(对应 G「故障不影响主功能」)。
- 3 家(omp/pi/opencode)不走胶囊 —— Magic Context 原生注入已覆盖,避免双重注入。

### 3.4 Rust 只读原语 `sqlite_query`

```rust
// src-tauri/src/ 下新增模块,lib.rs 注册;仅 SELECT,拒绝一切写语句
#[tauri::command]
async fn sqlite_query(db: String, sql: String, params: Vec<String>) -> Result<Vec<serde_json::Value>, String>
```

- 只读约束:语句白名单校验(仅 SELECT / PRAGMA table_info),防注入面。
- `src/kernel/ipc.ts` 加一个封装(唯一 `@tauri-apps/*` import 点,R3 合规)。
- 不引入 sqlx 等重依赖,用 rusqlite(若 Cargo.toml 已有 git2/portable-pty,rusqlite 量级可接受;以 cargo 构建实测为准)。

### 3.5 cli-shared:零新增

Phase 1 只复用既有:session 身份/路径知识(qoderSessions、piFamily、quota/codexLocal)用于面板归属展示;5 家 context 差异知识不需要(胶囊不写文件)。Phase 2 抽取需要的新 JSONL 知识,届时若 ≥2 消费者再下沉 cli-shared,否则留插件 phase2/ 内。

### 3.6 kernel:零新增

无新契约文件。ipc.ts 加 sqlite_query 封装一行(既有机制的自然延伸,非新语义)。

---

## 4. 改动面清单(如实)

| 改动 | 文件 | 性质 |
| --- | --- | --- |
| 新插件目录 | `src/plugins/memory-coordinator/` | 纯新增 |
| 注册 | `src/plugins/index.ts` | +1 行 |
| Rust 只读原语 | `src-tauri/src/`(新模块 + lib.rs 注册) | 新增,唯一 Rust 改动 |
| IPC 封装 | `src/kernel/ipc.ts` | +1 方法 |
| AppSettings | `src/kernel/settings.ts` + `settings.test.ts` 默认值断言 + sanitize 白名单 | 新增 memory 节(既有纪律:三者同步) |
| composer 挂点 | composer 插件的既有扩展点注册胶囊组件 | 经 ctx 注册,不改 composer 内部语义 |
| 依赖 | Cargo.toml + rusqlite(只读 feature) | 新增一个 Rust 依赖 |

**不改**:任何现有插件语义行为、PTY 管线、kernel 契约、用户仓库内文件。

---

## 5. 使用方式

### 5.1 首次启用 —— 跨平台安装管线(2026-09-05 PoC 实测定稿,mac/linux 已实证、win 留 PoC-6)

四阶段同一管线,三平台零差异,全程不依赖交互向导与进程冻结技巧:

1. **检测**:node 可用性(硬前置 ≥22:node:sqlite;上游引擎声明 ≥24,软提示);Magic Context 已装检测;omp/pi 既有 backend/compaction 配置与工具名冲突检测(如 pi-lean-ctx)。
2. **安装+配置(非交互组合,doctor 9 PASS 实证)**:`omp plugin install @cortexkit/pi-magic-context`(win 经 proc_communicate 直跑 node.exe/npm.cmd,`CREATE_NO_WINDOW` 防闪窗)+ 手写 `~/.config/cortexkit/magic-context.jsonc` + 直改 omp `config.yml`;失败显式回滚(上游向导中途落盘不回滚)。
3. **迁移触发(核心,node bootstrap)**:tmd-cli 先暂停/关闭自家全部 omp 会话(宿主全权)→ 扫描外部 omp/pi 进程(无 → 自动继续;有 → 列 PID+归属引导,支持稍后重试)→ `proc_communicate` 跑内置 bootstrap.mjs:`import { openDatabase, getMagicContextStorageResolution }` → 打开共享库即完成锁检测(此刻无 harness 进程=放行)与迁移(实证:干净环境 0.7s 首建库+83 迁移)→ 顺带取回库路径存 settings(不硬编码,win 亦为 home 相对路径)。
4. **验证+就绪**:schema_migrations 版本 + doctor → 面板转绿,胶囊通路生效。升级走同管线重跑 bootstrap(版本围栏增量迁移)。

### 5.2 日常

- omp/pi 会话:Magic Context 全自动(注入/提取/夜间治理),tmd-cli 只在面板展示状态。
- claude/codex/grok/kimi/qoder 会话:composer 出现「项目记忆 N 条」胶囊 → 展开 → 注入 → 照常发送。
- 治理:面板搜/forget(经 d 路代写映射 ctx_memory `archive`);「记忆整理」按钮经 proc_communicate 调 `/ctx-dream` 等价管线。

### 5.3 故障降级

池丢失/损坏/进程不在 → 胶囊消失、面板红条,session/composer/approvals 全不受影响;单 CLI 禁用开关按家隔离。

---

## 6. 验证

### 6.1 PoC(实现前,顺序执行)

| 编号 | 验证 | 判据 |
| --- | --- | --- |
| PoC-1 | 装 Magic Context(omp harness),定位共享 SQLite,导出 schema | **已通过**(库 `~/.local/share/cortexkit/magic-context/context.db`;67 表自 dist 实证;含 5 项计划外发现) |
| PoC-2 | 探明 5 家写入的官方入口 | **已通过(机制层)**:无对外 CLI/RPC;直写否决;**d 路选定**;工具族 ctx_memory(六 action)/ctx_search/ctx_note + /ctx-* 命令族全貌实证 |
| PoC-3 | 胶囊注入端到端 | 机制已备,**待迁移窗口**(omp 常驻 worker 与迁移锁死锁,解锁步骤见 PoC 报告) |
| PoC-4 | 并发安全 | 同上 |
| PoC-5 | 配置面 schema | **大半通过**(配置树 = 源码 zod schema;控制台字段映射有官方依据) |
PoC-1 失败(库不可读/无表)→ 整体方案回炉,升级为正式评审。

### 6.2 落地门禁

- 前端五连:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`。
- Rust 三连:`cargo test && cargo clippy --all-targets -- -D warnings && cargo fmt --check`。
- UI 真窗目检:`pnpm tauri:dev` 验胶囊四态(无记忆/有记忆/展开/池故障)与设置向导流。
- sqlite_query 只读约束单测:INSERT/UPDATE/DROP 一律拒绝。

### 6.3 验收映射

- Phase 1 验收 = PoC-3 场景可复现 + 故障降级目检(移走库文件,主功能回归绿)。
- 抗污染:dreamer 归属 Magic Context(上游能力),面板提供手动 forget;本设计不引入第二套治理。

---

## 7. 风险披露

1. Magic Context schema 未定型(当前 LATEST_MIGRATION_VERSION=83),升级可能碎 —— 已用「只读 + d 路代写(全走官方管线)」压耦合,碎则降级只显示「池不可用」。
2. **迁移锁与 omp 常驻架构死锁**(PoC 实证):任一 omp 会话活着即无法迁移、ctx_* 不注册;tmd-cli 多会话并行形态下**每次上游升级都撞**——安装/升级编排的迁移窗口状态机为核心流程;值得向上游报 issue(worker 进程不应计入阻塞)。
3. node 版本:上游要求 ≥24,实测 22 可跑但持续 EBADENGINE 警告——设置页提示。
4. 胶囊自动注入开启后每条消息带前缀,可能打扰 —— 默认手动,自动为显式 opt-in。
5. 记忆外发面:Magic Context historian 自身会将其 harness 内会话送其配置的模型 —— 属其产品行为,安装预览中披露;5 家会话 Phase 1 **不外发**(仅读)。
6. Phase 2 d 路依赖 omp 会话代写:omp 不可用/模型配额受限时代写失败 —— c 路(面板手动)兜底,设置页明示。

## 8. UI 定稿决策(2026-09-05 评审后设计对话演进,随 spec 一并批准)

交互原型:`docs/design/memory-capsule-demo.html`(tmd-cli 客户端还原,五态场景可切换,headless 全链路实测)。

### 8.1 记忆胶囊(composer 内,5 家读通路)

- 触发:5 家新会话创建时按 workspace 查池,命中则 composer 顶部渲染「项目记忆 N 条」胶囊;3 家(omp/pi)不出胶囊(原生注入已覆盖,防双重注入)。
- 交互:点击展开勾选列表(kind 徽标 + 来源 CLI)→「注入」拼为消息前缀块(可移除)→ 经 composer 正常发送通道进 PTY(即用户输入,零文件污染)。
- 默认手动;`memory.capsule.autoInject` 可开自动。池故障:composer 内一条红字提示,主功能不受影响;未安装:零打扰(无胶囊无红条)。

### 8.2 右栏 Memory 面板(注册进 TopBarPanelTabs)

功能面 = Magic Context 能力映射,按钮文案中文:

| 区块 | 功能点 |
|---|---|
| subbar | 重读池 / **诊断**(doctor 检查面:node/npx、omp/pi 插件注册、数据库完整性、context 插件冲突;故障项给「修复」)/ 设置入口 |
| 池状态卡 | 就绪绿点 + 条数;点击展开详情(数据库路径 / omp·pi 注册版本 / 版本+**更新**按钮 / 提取·治理引擎 / 向量索引进度) |
| 检索 | 搜索 + 双模式切换(关键词 BM25 / 语义向量);命中词高亮 + 命中计数;关键词零命中时「切换语义检索」一键引导 |
| 过滤 | kind chips(全部/偏好/决策/教训/事实,带计数)+ 来源 CLI chips(omp/pi),双轴正交 |
| 列表 | 逐条「移除(可恢复)」 |
| 底部动作条 | **记忆整理**(dreamer)/ **检索增强**(sidekick ctx-aug,命中条目 accent 描边)/ **控制台** |

### 8.3 Memory 控制台(中央 EditorCenter 位内嵌,不外开浏览器)

- 挂载位置 = AppShell 文件预览同位(独立 panel + tab 条「Memory 控制台」+ × 关闭),tmd-cli 自家 `--tmd-*` token 视觉,非上游皮肤。
- **配置映射原则:只映射上游 magic-context.jsonc 实证项,未造配置**——提取引擎(historian)/ 治理引擎(dreamer)模型、检索增强(sidekick)开关、向量索引(embedding,本地 MiniLM)开关;「胶囊注入策略」标注为 tmd-cli 自身设置;其余项注明「以 magic-context.jsonc 为准」。PoC-5 核实 schema 后才允许增补 UI 字段。
- 只读区:统计卡(总数/本周新增/来源分布条形/上次整理结果)+ 最近沉淀列表。
- 表单交互:改动标脏(黄)→ 保存(写入上游配置)→「已保存」(绿,淡出)。

### 8.4 安装引导与版本管理

- 未安装态:面板顶替为安装引导卡(功能说明 + **黄字副作用警示**:将接管 omp/pi 原生 compaction 与 automatic memory、覆盖 mnemopi/hindsight 配置)+「一键安装」→ 终端式逐行进度(`npx … setup --harness omp|pi` 实时输出)→ 完成转池空态。
- 版本管理:详情卡「版本」行显示已装/最新 + 「更新」按钮(更新中 → 版本号与插件版本同步刷新,已是最新态)。

### 8.5 文案

全部中文:dreamer→记忆整理、ctx-aug→检索增强、Dashboard→控制台、doctor→诊断、forget→移除;title 保留英文原名供对照。

### 8.6 实施期演进(2026-09-05/06 真窗目检驱动,随 Phase 1 落地)

- **Memory 功能全部收敛控制台,不进设置页**(用户裁决);安装卡独立组件(InstallCard),三 harness(omp/pi/opencode)检测+切换安装+幂等标识,opencode 配置改写带备份回滚。
- **沉淀三设置**(读取侧之外的写入侧):代写引擎(omp/pi/opencode,均注册 ctx_memory、同库同管线)+ 提炼模型(列表随引擎实时拉取:omp json / opencode 文本;pi 无非交互列表降级手填)+ 补充规则(追加指令优先遵循)。
- **合并/归档指令强化**:显式「立即调用工具,不要解释」;面板合并带结果校验(引擎回复 ok 后复核 ids 是否消失,否则反馈模型未执行)。
- **面板底部动作条**:控制台切换开合(非只开)+ 诊断按钮归位此行,治理信息降为次要文案。
- **Rust 只读原语修正**:READ_ONLY 连接读不到 WAL 未 checkpoint 数据(曾致「池就绪 0 条」),改 READ_WRITE + `PRAGMA query_only`;含回归测试。
- **发现**:pi 侧与用户已装 pi-lean-ctx 工具重名(ctx_search/ctx_expand),pi 代写引擎在该环境不可用直至用户处理;UI 已按引擎降级。
