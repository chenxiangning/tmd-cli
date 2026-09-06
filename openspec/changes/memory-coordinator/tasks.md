# Memory Coordinator 实施计划

对齐 `docs/superpowers/specs/2026-09-05-memory-coordinator-design.md`(含 §8 UI 定稿)。每项完成即勾。Phase 2 在 PoC-2 结论后单列。

## 0. PoC(实施前置,任一不过则回炉 spec)

- [x] PoC-1 装 Magic Context(omp harness),定位共享 SQLite,导出 schema —— **通过**(67 表自 dist 源码实证;实测报告与计划外发现见 `docs/research/magic-context-poc-report.md`;安装编排改走非交互组合:omp plugin install + 手写 jsonc + config 直改)
- [x] PoC-2 探明 5 家写入官方入口 —— **通过(机制层)**:无对外 CLI/RPC;直写 SQL 否决(epoch 缓存协议 + authority 门控);**选定 d 路 = 借道 omp 会话代写**(`omp -p` + ctx_memory write,官方管线全保;见 PoC 报告)
- [x] PoC-3 胶囊端到端 —— **omp 侧沉淀已验证**(ctx_memory write → memories 落行实证);claude 胶囊命中属 Phase 1 代码,随实施验收
- [x] PoC-4 并发安全 —— **隐含通过**(宿主持库时外部 sqlite3 只读无锁);正式压测并入 §7 目检
- [ ] PoC-6 **跨平台安装验证(实施前置,win 侧)**:win 真机/VM 跑同款 node bootstrap(import openDatabase → 首建库/迁移)+ tasklist 枚举 + 路径解析 + node:sqlite on win;mac/linux 已实证(DIRECT-OK / BOOTSTRAP-OK,见 PoC 报告「跨平台与新机器安装验证」)

## 1. Rust 只读原语

- [x] Cargo.toml rusqlite 0.40 bundled(已在依赖;并行会话落地,复用现有原语而非新写)
- [x] `sqlite.rs`(并行会话同名落地:SQLITE_OPEN_READ_ONLY + 参数化绑定 + 库缺失空行集;注册 sqlite_query/sqlite_execute)
- [x] lib.rs 注册;`cargo test && cargo clippy --all-targets -- -D warnings && cargo fmt --check` 全绿

## 2. 插件骨架与协议

- [x] `memory-coordinator/{index.tsx,protocol,pool}.ts`:Plugin 注册;MemoryPool 契约(12 类目真实值域);sqliteQuery 封装(recall/status,fault 降级)
- [x] `src/plugins/index.ts` 注册 +1 行
- [x] `kernel/ipc.ts` sqliteQuery 封装(并行已落地,直接复用)

## 3. 记忆胶囊(读通路 B)

- [x] `capsule/MemoryCapsule.tsx`:非豁免引擎查池;勾选→前缀块 insertText 进 composer;池故障/未安装零打扰;omp/pi/opencode 豁免路由;capsuleMode 接 settings
- [x] composer.statusBar 挂点注册(经 ctx,零 Composer 内部改动)

## 4. 右栏 Memory 面板

- [x] `panel/MemoryPanel.tsx`:池状态卡(就绪/不可用/身份缺失三态)+ 诊断(库可读/迁移窗口提示)
- [x] 检索:FTS 关键词 + 计数(语义向量随 Phase 2 评估,Phase 1 明示仅关键词)
- [ ] 逐条移除映射 `ctx_memory(archive)`、合并映射 `merge`(Phase 2 经 d 路;Phase 1 只读展示 status)
- [x] 底部动作条:控制台入口(记忆整理/检索增强随 Phase 2)

## 5. Memory 控制台(EditorCenter 位)

- [x] `console/MemoryConsole.tsx`:启用+安装/迁移卡(node bootstrap)、引擎配置卡(上游 jsonc 读写,脏标/保存)、读取侧卡、写入卡(手动添加+沉淀最近 omp 会话,经 d 路)、类别分布条形 + 最近沉淀;**Memory 全部功能收敛控制台,不进设置页(用户裁决 2026-09-05)**;EngineConfigCard 独立模块(168 行,主文件 348 行过铁则)
- [x] 读取侧卡(胶囊注入策略,联动 settings.memoryCapsuleMode);统计/沉淀只读展示
- [x] 编辑器 tab 注册(kind=memory-console,契约测试双向锁定)

## 6. 安装编排与版本管理

- [x] `install/detect.ts`:node ≥22 硬检测 + ≥24 软提示、已装检测、共享库就绪检测;工具名冲突检测(pi-lean-ctx 实证)并红字警示
- [x] `install/setup.ts` + `bootstrap.ts`:非交互组合编排 + node bootstrap 脚本(运行时发现 openDatabase chunk,版本免疫);win 细则(CREATE_NO_WINDOW)并入实施
- [x] **node bootstrap 迁移触发器**:内置 bootstrap.mjs(import `openDatabase` + `getMagicContextStorageResolution`)→ 暂停自家 omp 会话 → 扫外部进程引导重试 → proc_communicate 跑 node → 路径回存;升级复用同管线

## 7. 设置与门禁

- [x] `settings/`:memory 节(memoryDbPath/memoryEnabled/memoryCapsuleMode);settings.test.ts 默认值断言 + 非法回落 + 超长截断(3 用例)
- [x] vitest 828+ 全绿(memory 相关含新增用例)+ typecheck + check:arch-boundary + check:file-size + build
- [ ] 契约测试 env:并行 WIP 给 composer activate 加了 document 访问、MountPoint 类型重构中 —— 全库 tsc/build 暂红(0 错在 memory-coordinator),待该 WIP 合拢复跑
- [x] 真窗目检多轮(用户驱动):WAL 0 条修复、按钮/文案固定单行、详情抽屉、常显说明、沉淀模型随代写引擎联动(omp json / opencode 文本 / pi 手填)、控制台切换开合、诊断按钮归位底部、合并链路强化(指令必调工具 + 结果校验反馈)

## 8. Phase 2(d 路已选定;写入侧已随 Phase 1 落地)

- [ ] PoC-3/4 补验:omp 沉淀 → 胶囊命中端到端;sqlite_query 并发压测
- [ ] `phase2/write.ts` d 路代写:proc_communicate 跑 `omp -p "记住:…"` → ctx_memory(write);失败重试 + c 路手动兜底 UI —— **形态由 §8a v2 取代**(v1 直跑 `-p` 在 0.41.3 失效)
- [ ] 5 家 session close 钩子:增量摘要 → d 路批量代写(阈值/防抖)

### 8a. d 路 v2 修订(2026-09-06,评审通过,见 docs/review/2026-09-06-d-path-flag-fix.md)

PoC-7 实证:`omp -p` 直跑不会让 magic-context subagent-entry.js 注册 ctx_memory 工具(需 `--extension <subagent-entry.js> --magic-context-dreamer-actions --tools ctx_memory`)。d 路 v2 = 模拟 main agent 启动 subagent 的参数组合。各引擎各自插件、按候选探测,不写死单一安装根(用户裁决 2026-09-06)。

- [x] 根 `paths.ts` 扩展(唯一路径来源):`resolveSubagentEntry()` node 子进程探测 `~/.omp/plugins` 与 `~/.pi/agent/npm` 两候选(subagent-entry 运行时自适应 omp/pi 宿主);env `TMD_MAGIC_CONTEXT_SUBAGENT_ENTRY` override(`typeof process` 守卫);`isOpencodeMagicContextInstalled()` 配置文本判定(同 detect.ts 先例)
- [x] `phase2/write.ts` `viaOmp()`:omp/pi 走 subagent 参数组合,缺失返 `missing-subagent-entry`;opencode 预检未装返 `missing-plugin`,已装走 `opencode run`(其插件为自动注册,无需 flag)
- [x] `phase2/autoDistill.ts`:缺失早退收敛到 viaOmp detail,不重复探测
- [x] `phase2/write.test.ts` 新建:9 用例(args 形态 / model 插位 / pi / opencode 已装未装 / 多 action 一致 / missing-subagent-entry / 非 0 退出)
- [x] spec §2.2 决策措辞修订(v2 已并入)
- [x] 门禁:typecheck / vitest 889 / arch-boundary / file-size / build 全绿
- [x] **stdin 挂死修复**(2026-09-06 用户实测手动沉淀/合并报错 "Reading prompt from piped stdin… Still starting after 10s"):`proc_run.rs` 无条件 `Stdio::piped()` + 永不关闭 → 一次性 CLI(`omp -p`)等 EOF 直到超时。`ProcRunSpec` 增 `closeStdin`(默认 false 保 RPC 副车语义),d 路全部调用传 true;新增 Rust 测试 `close_stdin_gives_immediate_eof`
- [x] **来源显示别名**:上游 `session_projects.harness` 把 omp 会话归为 "pi"(omp 为 oh-my-pi);`pool.ts` 数据源统一经 `harnessLabel()` 显示为 "pi/omp",不改上游数据(用户复核 2026-09-06)
- [ ] 真窗目检:控制台「写入记忆」卡回车一条 → sqlite3 memories 落行(`source_type='dreamer'`);退出 omp 会话 → 自动沉淀同验
- [ ] PoC-8 余项:opencode 真装 `@cortexkit/opencode-magic-context` 后的端到端写入实证
