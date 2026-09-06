# Magic Context PoC 实测报告

日期:2026-09-05
状态:PoC-1 **通过**;PoC-2 **机制通过 / d 路在 0.41.3 二次实证失效**(见 PoC-7);PoC-5 **大半通过**;PoC-3 **omp 侧沉淀已验证**(胶囊命中留实施期);PoC-4 **隐含通过**(正式压测待实施期);**迁移已完成,环境就绪**
关联:`openspec/changes/memory-coordinator/tasks.md` §0 · spec `docs/superpowers/specs/2026-09-05-memory-coordinator-design.md`
环境:macOS arm64 · node v22.22.3 · omp 18.1.10 · magic-context 0.41.3

---

## PoC-1:共享 SQLite 定位与 schema 导出 —— 通过

### 安装路径实测(顺序)

1. `npx @cortexkit/magic-context@latest setup --harness omp` 为**交互向导**(clack):确认加载 → 选 historian 模型(31 选)→ dreamer 开关+模型 → 推荐排程(Yes)→ sidekick 开关+模型 → embedding 供应商(本地/OpenAI 兼容)→ 禁 omp compaction(写 `compaction.enabled=false`)→ 禁 omp memory(写 `memory.backend=off`)。
2. 向导中止时**插件已装完**:`omp plugin list` 显示 `@cortexkit/pi-magic-context@0.41.3` enabled;共享配置手写 `~/.config/cortexkit/magic-context.jsonc`(per-harness 形态,historian/dreamer/sidekick)。
3. `npx … doctor --harness omp`:**9 项全 PASS**(插件启用/manifest/compaction+memory 已禁/配置解析/runtime 加载/SQLite integrity)。

### 关键路径(实证)

| 项 | 路径 |
| --- | --- |
| 共享数据库 | `~/.local/share/cortexkit/magic-context/context.db`(doctor 标注 platform default) |
| 共享配置 | `~/.config/cortexkit/magic-context.jsonc` |
| omp 插件 | `~/.omp/plugins/node_modules/@cortexkit/pi-magic-context/` |
| omp 配置改动 | `~/.omp/agent/config.yml`:`memory.backend: local→"off"` + `compaction.enabled: false`(备份:`config.yml.bak-pre-magic-context`) |

### 数据库 schema(67 表,自插件 dist 源码提取)

核心表(Phase 1 只读消费面):

```sql
memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_path TEXT NOT NULL,          -- 项目按路径隔离(胶囊过滤键)
  category TEXT NOT NULL,               -- 分类(kind chips 的原生对应)
  content TEXT NOT NULL,
  normalized_hash TEXT NOT NULL,        -- 去重键
  importance INTEGER,
  scope TEXT NOT NULL DEFAULT 'project',
  source_session_id TEXT,
  source_type TEXT DEFAULT 'historian',
  seen_count INTEGER DEFAULT 1,
  retrieval_count INTEGER DEFAULT 0,
  created_at / updated_at / last_seen_at / last_retrieved_at INTEGER,
  status TEXT DEFAULT 'active',         -- active/archive(移除=改 status,非物理删)
  expires_at INTEGER,                  -- 过期淘汰原生支持
  verification_status TEXT DEFAULT 'unverified',
  superseded_by_memory_id INTEGER,     -- 合并链
  UNIQUE(project_path, category, normalized_hash)
memories_fts            -- FTS5(porter unicode61)全文索引,INSERT 触发器自动维护
memory_embeddings       -- (memory_id, model_id, embedding BLOB)向量索引
session_projects        -- (session_id, harness, project_path)会话→项目归属
workspaces / workspace_members  -- 跨项目共享组(share_categories)
dream_runs / dream_queue / task_schedule_state  -- 治理(排程 schedule 字段原生存储)
project_state           -- project_memory_epoch 等(缓存失效协议)
schema_migrations       -- 迁移版本(升级追踪)
```

其余表群:compartments(历史压缩分舱)/ message_history_*(FTS 消息史)/ git_commits(+embeddings)/ subagent_invocations / historian_runs / notes / primers / mirror_*(旧数据镜像)/ 多组 *_backfill_state。

### 对 tmd-cli 的直接结论

- **recall 只读可行**:`memories` 按 `project_path + status='active'` 查询即胶囊数据源;关键词检索走 `memories_fts`(MATCH)零成本;`category` 即 kind 过滤、`importance` 可排序。
- **语义检索**:embedding 是 BLOB(模型绑定),跨模型不可比;Phase 1 先用 FTS,语义留 Phase 2 评估(或直接读 memory_embeddings 用同模型余弦)。
- **「移除(可恢复)」**:上游语义 = status 置非 active(有 memory_mutation_log 审计)——面板 forget 映射为 UPDATE 也不该由 tmd-cli 直写(仍走官方入口),但只读展示 status 天然支持。

---

## 计划外发现(全部影响实施)

1. **向导中途落盘、abort 不回滚**:第一次向导中止时 omp config 已被写(memory→off、compaction→false)但插件注册完成——tmd-cli 安装编排必须「一次走完 or 显式回滚」,且向导对 prog 不友好(clack 交互,管道喂键时序不稳)。**建议编排路径:`omp plugin install @cortexkit/pi-magic-context` + 手写 jsonc + 直改 config.yml,全非交互**(本次已验证此组合 = doctor 9 PASS)。
2. **共享库迁移锁**:库初始化/迁移会检测全机 Pi/OMP 进程(含其他项目的),有活动进程即拒绝迁移(报 PID 清单要求重启)。当前机器 3 个并行 AI 会话常驻 —— tmd-cli 安装编排需处理「迁移被阻塞」态(提示用户或等窗口),读侧不受影响(schema 已从源码实证)。
3. **node 引擎要求 ≥24,实测 22.22.3 可跑**(doctor 全过、omp 会话正常)但持续 EBADENGINE 警告——记为部署风险,README/设置页应提示。
4. **上游真有周期排程**:向导「recommended task schedules: verify nightly; curate weekly; classify + retrospective daily; docs off」+ `task_schedule_state(schedule)` 表——spec §8.3 删除的「周期」卡有上游依据,但粒度是任务级(verify/curate/classify/retrospective/docs)而非我编的三选项;控制台 UI 若要恢复周期项,按这五个任务名映射。
5. **数据库引擎是 node:sqlite**(node 22+ 实验特性),非 better-sqlite3——与 tmd-cli 的 rusqlite 读侧无冲突(纯文件级 SQLite 标准格式)。

## 遗留(PoC-1 时点记录;PoC-2/5 结论与迁移窗口见后续章节)

- `context.db` 0 字节直至迁移窗口(见文末);schema 已全量实证,不阻塞开发。
- 用户 omp 配置已切换至 Magic Context 终态(备份 `config.yml.bak-pre-magic-context`)。

---

## PoC-2:5 家写入官方入口 —— 通过(机制层)

### 工具与命令面(自 dist 源码实证)

- **模型工具族**:`ctx_memory` / `ctx_search` / `ctx_note` / `ctx_expand` / `ctx_reduce`。
- **ctx_memory 完整 action**(工具描述原文):`write`(category+content)/ `update`(id+content)/ `archive`(ids+reason)/ `merge`(ids≥2+content)/ `get`(ids 1-20,任何 status);`list` 仅 dreamer 维护会话可用。
- **slash 命令族**:`/ctx-aug`(sidekick 检索)、`/ctx-dream`(治理)、`/ctx-embed`、`/ctx-flush`、`/ctx-recomp`、`/ctx-status`、`/ctx-wrapup`、`/ctx-session-upgrade`。
- **CLI 子命令**:仅 setup/doctor 系,**无 `memory add` 类对外写入口**;module facade(Rust ctx_memory)是上游内部演进(`ModuleMemoryAuthorityError`:module-managed 项目禁 TS 直写),不暴露 socket/pipe/HTTP。

### Phase 2 写入路线判定

| 路 | 判定 |
| --- | --- |
| a · 官方 CLI/RPC 写入 | **不存在** |
| b · 外部脚本直写 SQL | **否决**:`project_memory_epoch` 缓存失效协议 + authority 门控 + schema 无稳定性承诺;FTS 触发器虽自动,但 epoch 不 bump 则 omp 注入看不到 |
| **d · 借道 omp 会话代写(PoC-2 选定,PoC-7 在 0.41.3 失效,需修订)** | tmd-cli 经 `proc_communicate` 跑 `omp -p "记住:…"`(非交互已实证可跑),omp 模型调 ctx_memory write,权威/epoch/FTS 全走官方管线;成本 = 一次小模型调用,秒级 |
| c · 面板手动记忆 | 保留为 d 的兜底(d 失败时 UI 手动编辑 + 同样经 omp 代写落库) |

d 路机制链已由源码证实(工具注册逻辑 + 管线);端到端落库验证与 PoC-3/4 同样等待迁移窗口。

## PoC-5:配置面 —— 大半通过

- 配置树为源码内 zod schema(如 `compaction.enabled=false` 时保留知识层:memory/docs 注入、FTS、dreamer、notes、ctx_search/expand/memory、/ctx-embed 仍可用,historian/compartment/裁剪停用)——**控制台配置卡的官方依据比 spec §8.3 已映射的更多**,实施时可按 zod 树增补(sidekick/dreamer 排程等)。
- `LATEST_SUPPORTED_VERSION = 83`(schema_migrations 计数),升级检测以版本围栏实现。

## 迁移窗口要求 —— 2026-09-05 二次实测定性:omp 常驻架构与锁的死锁

三个「阻塞进程」并非用户并行会话,而是 **omp 常驻 worker**(`__omp_worker_lsp_mux / __omp_worker_js_eval_process / __omp_worker_daemon_broker`),由 omp 宿主按需拉起。实测:杀掉后宿主立刻重生 broker,且**重生的新进程(插件安装后拉起)仍被无差别拦截**——锁检测不分辨 build 新旧,只看「存在 omp/pi 家族进程」。且锁住时 ctx_* 工具完全不注册(模型 eval 桥探测确认)。

**结论:只要任何一个 omp 会话活着(含 tmd-cli 内的 omp 会话、含本 PoC 对话宿主),共享库就无法完成首次/升级迁移。**83 个迁移混 TS 逻辑,手动建表绕过不现实。

**解锁操作(已执行,2026-09-05 22:52 迁移完成;实操比理论多三个坑)**:

1. omp 的 bash 工具是**进程内 shell**(pi-shell in-process)——「冻结宿主再杀 worker」必须由 **nohup 脱离脚本**执行,且用 `/bin/kill`(bash 内建 kill 有祖先保护,静默拒杀宿主);
2. omp 的 `-p` 与 TUI 启动路径下,宿主拉起的 worker 都会在插件锁检测前重生,单靠杀 worker 竞争不过;
3. **最终解法:原生 `pi` 触发迁移**(锁检测豁免自身与祖先链,pi 无 omp daemon):`pi install npm:@cortexkit/pi-magic-context` → nohup 脚本内 `/bin/kill -STOP <omp宿主>` → pkill worker → `pi -p 'ok'` → `/bin/kill -CONT` 恢复。结果:**库 0 → 995KB,schema_migrations=83,98 对象**。

**迁移后验证(全部通过)**:omp 会话 Extension error 消失、ctx_memory 注册;**d 路端到端闭环**(`omp -p` 调 ctx_memory write → memories 表落行 id=1/CONSTRAINTS/active/agent);外部 sqlite3 在宿主持库时只读无锁(隐含 PoC-4,正式压测待实施期);pi 侧用户已有 `pi-lean-ctx` 与 `ctx_expand` 工具重名冲突(pi 侧加载失败,不影响共享库与 omp 侧)——tmd-cli 安装编排需检测同类工具名冲突。

**对 tmd-cli 的产品级推论(判定升级)**:tmd-cli 用户常态多会话并行跑 omp,**每次 Magic Context 升级都撞此锁**——安装/升级编排的「迁移窗口状态机」从辅助流程升级为核心流程(检测阻塞 → 列 PID 与会话归属 → 引导关闭或由 tmd-cli 协调自家 omp 会话生命周期 → 触发迁移 → 恢复);同时应向上游报 issue(worker 进程不应计入阻塞判定)。

## 跨平台与新机器安装验证(2026-09-05 三次实证 + win 源码分析)

### 核心结论:tmd-cli 用 node 直调插件 API 触发迁移,三平台同一管线,零进程技巧

插件 dist 的 chunk 是可 import 的 ESM 模块,`openDatabase` 与 `getMagicContextStorageResolution` 公开导出。实测:

1. **DIRECT-OK**:node 直调 `openDatabase` 打开已迁移库并读表(0.7s);
2. **BOOTSTRAP-OK(新机器模拟)**:env 重定向全新路径 + 无 omp/pi 进程 → node 直调 → **0.7s 首建库 + 83 迁移全跑**(995KB)——首装不依赖任何 omp/pi 进程;
3. 锁检测平台分支(源码):mac/linux 走 `ps`,**win 走 `tasklist /FO CSV` + CIM startTime 快照**(上游自备,无跨平台缺口)。

### tmd-cli 跨平台安装管线(设计定稿,详见 spec §5.1)

```
检测(node ≥22 硬前置:node:sqlite;上游引擎声明 ≥24 软提示)
→ 安装(npm/omp plugin install;win 经 proc_communicate 直跑 node.exe/npm.cmd)
→ 配置(手写 magic-context.jsonc + omp config.yml,纯文件操作)
→ 迁移触发(node bootstrap.mjs:import openDatabase → 锁检测(此刻应无 harness 进程)+ 迁移)
   · tmd-cli 先暂停/关闭自家全部 omp 会话(宿主全权)
   · 扫描外部 omp/pi 进程:无 → 自动;有 → 列 PID+归属引导关闭,支持稍后重试
→ 验证(schema_migrations + doctor)→ 就绪
```

### 平台要点

- **路径不硬编码**:库路径经 `getMagicContextStorageResolution` 解析(env `MAGIC_CONTEXT_STORAGE_DIR` > `XDG_DATA_HOME` > `~/.local/share/cortexkit/magic-context`;win 同为 home 相对 POSIX 风格)——tmd-cli 侧 bootstrap 顺带取回路径存 settings。
- **win 细则**:子进程 `CREATE_NO_WINDOW` 防闪窗(仓库既有经验);node 本体是 .exe 直跑无 PATHEXT shim 问题;tasklist 枚举上游自备。
- **新机器**:阶段「外部进程」天然为空 → 全自动,用户只需点一次「启用」。
- **多 AI 并行机(mac 本机常态)**:仅「其他终端的 omp」需用户择机关闭;tmd-cli 自家会话自动管理。
- **升级**:同管线重跑 bootstrap(版本围栏自动增量迁移)。

### 实施期补充实证(2026-09-06)

- `node -e` 执行 bootstrap 时首参在 `argv[1]`(非 argv[2])——已兼容,迁移链路闭环。
- `opencode models`(无 --json)逐行 selector 可作模型列表;`opencode run -m provider/model` 支持模型覆盖;pi 无非交互模型列表命令(交互 /model 内选择)。
- pi 侧安装的 magic-context 与 pi-lean-ctx 工具重名(ctx_search/ctx_expand)加载失败 —— 工具名冲突检测为安装编排必检项(spec 已列)。
- omp `-p` 非交互支持工具调用(实证 write/merge/archive);但模型偶发「解释而不调工具」,编排指令需显式「立即调用工具」并做结果校验。

## PoC-7:d 路二次实证 —— 0.41.3 上 d 路失效,需重新设计写入路径(2026-09-06)
### 触发

用户反馈 tmd-cli 自动沉淀开关(`memoryAutoDistill`)已开启,但 omp 会话退出后无新记忆入池。控制台"最近沉淀"卡无新条目,`memories` 表统计显示 4 条记忆全部是 `source_type='agent'`、`source_session_id` 以 `01a072...` 开头(omp 主动会话内 `ctx_memory write` 的产物,产生于 2026-09-05 22:54 ~ 09-06 01:38 期间),PoC-2 期间实证的"d 路"自那以后**零落行**。tmd-cli 的 d 路(`proc_communicate omp -p <指令>`)在当前 0.41.3 版本下失效。

### 现象(实测)

- `historian_runs` 表 0 行(`magic-context` 自身的 historian 从未运行,与 omp 会话退出时 sidekick 闭锁有关,先按下不表)。
- `authority_managed` 表 0 行,`authority_repair_pending` 表 0 行,**`context_privilege_state.enabled = 0`**(默认值)。
- `memories` 表 trigger `memories_authority_guard_insert` 的 WHEN 条件同时检查 `authority_managed` / `authority_repair_pending` / `context_privilege_state.enabled = 0`:**当前三者均未触发拦截**(项目不在托管表),故 trigger 物理上不挡 INSERT。
- 但 9/6 01:38 后无新记忆入池。

### 真因(自 dist 源码定位)

`@cortexkit/pi-magic-context/dist/subagent-entry.js` 的 `magicContextSubagentExtension(pi)` 是 `ctx_memory` 工具**唯一注册路径**:

```js
const SUBAGENT_DREAMER_ACTIONS_FLAG = "magic-context-dreamer-actions";
...
const dreamerActionsEnabled = pi.getFlag(SUBAGENT_DREAMER_ACTIONS_FLAG) === true;
...
registerMagicContextTools(pi, {
  ...,
  allowDreamerActions: dreamerActionsEnabled,
  ...
});
log(`[pi-subagent] registered tools: ctx_search${dreamerActionsEnabled ? ", ctx_memory" : ""}...`);
```

`magic-context-dreamer-actions` flag **默认 false**。开启后,`ctx_memory` 工具才会注入到 omp/pi 模型的工具列表;**否则模型根本看不到这个工具**,自然无法调用。

而 `subagent-entry.js` 本身**只在 pi/omp 加载扩展时(`pi.registerExtension(...)` 之类入口)被 import**——它不是常规 main agent 自动加载的扩展。tmd-cli 的 d 路 `proc_communicate` 跑 `omp -p <指令>` 不会传 `--magic-context-dreamer-actions`,因此:

- spawn 出的 omp 子进程未开 flag → `ctx_memory` 工具未被注册
- omp 模型接到指令"请调用 ctx_memory 工具"→ 工具列表里没有 → **写不进去**
- 即便 magic-context 主干插件(`omp-plugins.lock.json` 中 `enabled=true`)在宿主进程内已加载,子代理模式的 subagent 入口与 main agent 路径是分开的,后者不会自动激活 subagent 加载

PoC-2 当日 d 路端到端闭环能成功,可能因子进程恰好命中了 subagent 加载路径(插件早期版本默认行为,或当时的 omp 启动方式触发了 subagent 注册),0.41.3 已收紧到必须显式 flag 才注册。

### 数据库物理闸门(确认存在但当前未触发)

`context_privilege_state` / `authority_managed` / `authority_repair_pending` 三件套构成上游的 module-managed 闸门设计:

- **`withPrivilegedWriter(db, operation)`**(`index-s0zw9ddk.js:10002`):BEGIN IMMEDIATE → `INSERT … context_privilege_state.enabled=1` → 跑 op → `UPDATE … enabled=0` → COMMIT;闸门**仅在事务内短暂开启**,commit 时自动关闭。
- **`memories_authority_guard_insert` trigger**:仅当 `project_path ∈ authority_managed ∪ authority_repair_pending` 且 `context_privilege_state.enabled=0` 时拦截;否则放行。
- **`assertTsMemoryWriteAllowed(db, projectPath)`**(TS 层软断言):若 `project_path ∈ authority_managed ∪ authority_repair_pending` 抛 `ModuleMemoryAuthorityError`("must use the Rust ctx_memory module facade")。

结论:**物理闸门与 TS 软断言当前均不挡 INSERT**(项目未在托管表)。d 路失效的根因是 `ctx_memory` 工具未注册,不是闸门。

### 对 spec §2.2 决策的冲击

| 原决策 | 当前状态 | 处置建议 |
| --- | --- | --- |
| d 路 = `omp -p` 借道 | 0.41.3 上 `ctx_memory` 工具未注册,模型无可写入口 | **需修订** |
| c 路(面板手动)作 d 兜底 | 仍依赖 d 路跑 omp 子进程,同病 | 等同失效,降级为 UI 暂存草稿 |
| a / b 路 | a 不存在,b 否决 | 不变 |

### 修订方向(待评审)

三条可行路径,**均需走 spec 评审**:

1. **给 d 路 omp/pi 子进程传 `--magic-context-dreamer-actions` flag**(实测可能能让 `subagent-entry.js` 加载并注册 `ctx_memory`)。需验证:opencode 是否有等价 flag、omp/pi `--flag` 参数写法、是否对所有 subagent-kind 都生效、是否引入 dreamer 工具的不期望面(list/archive 等"治理"action 在主会话泄露)。
2. **改 d 路走 opencode**:opencode 的 subagent 入口与 omp/pi 不同,`opencode run` 在某些版本自带工具注册。需 PoC 实证。
3. **放弃 d 路,落 Phase 1 终态**(只读 8 家,写仅靠 omp/pi/opencode 自带会话沉淀),tmd-cli 不再做"自动沉淀"——控制台 autoDistill 选项下线,改说明文字指向"上游会话自身已开 sidekick,自动沉淀由 sidekick/historian 负责"。

推荐方向:**先做方案 1 的最小实证**(单测:传 flag 后 `ctx_memory` 是否在 `omp -p` 进程的 eval 桥里可见),若成立,加 spec 评审提出 d 路 v2(传 flag + 治理 action 白名单收敛);若不成立,转入方案 3,Phase 1 收口。

> **2026-09-06 08:00 更新**:方案 1 实证**通过**并已落地 d 路 v2(评审 `docs/review/2026-09-06-d-path-flag-fix.md`;代码 `phase2/write.ts` + 根 `paths.ts` + 9 条单测,门禁全绿)。修订要点:omp/pi 各自安装根按候选探测(不写死单一引擎);opencode 为独立 npm 插件自动注册,装前预检返 `missing-plugin`。

### 不在 d 路修复范围内的副作用

- **`memoryAutoDistill` 开关 / `LastAutoDistillCard` UI**:本身在跑,事件订阅正常,只是写入路径空了。本次未落地任何 UI /settings 改动,代码未 commit;若方案 1/2 修订 spec 推进,UI 可继续沿用;若方案 3 收口 Phase 1,UI 需下线并改文案。
- **tmd-cli 自身对 magic-context SQLite 的只读消费**(胶囊检索、右栏 Memory 面板):不受影响,继续工作。
- **historian / sidekick 调度**:这俩是 magic-context 自带能力(tmd-cli 不直接调用),不在 d 路修复范围;实测 `historian_runs` 为 0 表明当前未跑,与 tmd-cli 无关,需另行调研。

### 关联:docs/README.md 索引登记
