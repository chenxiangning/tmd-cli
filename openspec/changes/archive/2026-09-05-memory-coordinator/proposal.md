## Why

tmd-cli 托管 8 个 AI CLI,但无跨 CLI 的项目级记忆层:用户在 A CLI 交代的偏好/决策,B CLI 一无所知。选型 Magic Context(MIT,本地 SQLite 共享记忆池,原生覆盖 omp/pi)做唯一记忆池,tmd-cli 新增 memory-coordinator 插件做编排。设计 spec 见 `docs/superpowers/specs/2026-09-05-memory-coordinator-design.md`(已批准,含 §8 UI 定稿),交互原型 `docs/design/memory-capsule-demo.html`,评审记录 `docs/review/2026-09-05-memory-integration-design-review.md`。
全部 PoC 实证与计划外发现见 `docs/research/magic-context-poc-report.md`(安装路径/67 表 schema/工具族/d 路判定/迁移死锁/跨平台验证)。
**实施状态(2026-09-05)**:Phase 1 代码落地,门禁全绿(vitest 819 / tsc / file-size / arch-boundary / build / cargo 174+clippy+fmt);待真窗目检;PoC-6(win 实测)与 Phase 2(d 路)随后。

## What Changes

- **分期**:Phase 1 = 8 家全部可读(omp/pi 由 Magic Context 原生注入,其余 5 家经 composer 记忆胶囊);Phase 2 = 5 家可写,路线 **d 已选定(PoC-2 实证)**:proc_communicate 跑 `omp -p` 借道 omp 会话调 `ctx_memory(write)` 代写,官方管线全保;c 路面板手动兜底。
- **安装编排核心:迁移窗口状态机**(PoC 实证):共享库迁移带全机 omp/pi 进程锁且与 omp 常驻 worker 死锁——编排须检测阻塞 → 列 PID/会话归属 → 引导关闭(tmd-cli 协调自家会话)→ 触发迁移 → 验证恢复;安装走非交互组合(omp plugin install + 手写 jsonc + config 直改,doctor 9 PASS 实证),失败显式回滚。
- **新插件** `src/plugins/memory-coordinator/`(扁平结构,协议留插件内不进 kernel——单插件语义):protocol.ts(MemoryPool 契约)/ pool.ts(sqlite_query 只读 recall/status)/ capsule(记忆胶囊:勾选→注入为消息前缀,经 composer 发送通道进 PTY)/ install(检测+diff 预览+副作用警示+npx setup 编排+版本更新)/ panel(右栏面板:池状态卡+详情、诊断 doctor、检索双模式+高亮+语义引导、kind/来源过滤、移除)/ console(中央 EditorCenter 位「Memory 控制台」tab:配置映射+统计+最近沉淀)/ phase2(骨架占位)。
- **注册面**:allPlugins +1 行;右栏面板注册(filePanel);设置分区(settingsRegistry);composer 挂点(胶囊);编辑器 tab(EditorCenter 同文件预览位)。**配置映射原则:只映射 magic-context.jsonc 实证项**(提取/治理引擎模型、sidekick、embedding),未造配置。
- **不做**:不自造向量检索/治理;不动 harness 内置 memory://;不写用户仓库内文件;tauri 内零 AI 调用;Phase 1 不做 5 家写入。

## Capabilities

### New Capabilities

- `memory-coordinator`: 记忆池只读访问(sqlite_query)、composer 记忆胶囊(5 家读通路)、右栏 Memory 面板(检索/过滤/诊断/治理入口)、Memory 控制台(配置/统计/沉淀)、安装引导与版本管理。

### Modified Capabilities

- `composer`: 新增胶囊挂点(仅渲染,不改发送语义;注入即消息前缀,仍走既有 writeSession 路径)。
- `file-panel`: 面板注册表新增 Memory 项(subbar + 内容路由)。
- `editor-tabs`: 新增「Memory 控制台」tab 类型(EditorCenter 位)。
- `app-settings`: 新增 memory 节(capsule.autoInject / 按引擎开关 / 隐私披露),settings.test.ts 默认值断言 + sanitize 白名单同步。

## Impact

- **新增**:`src/plugins/memory-coordinator/` 全目录、`src-tauri/src/sqlite_query.rs`(暂名)、`openspec/changes/memory-coordinator/`(本契约)。
- **修改**:`src/plugins/index.ts`(+1 行)、`src-tauri/src/lib.rs`(mod + 命令注册)、`src-tauri/Cargo.toml`(rusqlie 只读 feature)、`src/kernel/ipc.ts`(+1 方法)、`src/kernel/settings.ts`(+memory 节)。
- **不改**:PTY 管线、kernel 现有契约、任何现有插件语义行为、用户仓库文件。
- **架构边界**:R1 维持(插件只依赖 kernel);R3 维持(@tauri-apps 仅 ipc.ts);单插件语义不入 kernel(协议留插件内,出现第二消费者再上提)。
- **门禁**:vitest + tsc + check:file-size + check:arch-boundary + build;cargo test/clippy -D warnings/fmt;tauri:dev 真窗目检(胶囊四态/面板/控制台/安装向导);PoC 五项全过方可进实现(见 tasks §0)。
