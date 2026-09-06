# 2026-09-05 插件化架构审查与插座化重构

日期:2026-09-05
状态:已落地(本文记录审查结论与取舍,代码同批提交)

## 背景与目标

对照 codemoss(臃肿难维护的对照组)对 tmd-cli 做全面架构体检,四个方向:
架构符合性(插件化/模块化)、插件间泄露、插座是否全为通用接口(反硬编码)、
臃肿苗头。CI 铁则(R1/R3/R4/500 行)审查前已全绿,本次聚焦 CI 查不到的语义层。

四路并行侦察(kernel 插座 / app-shell 硬编码 / cli-* 重复度 / codemoss 教训)
+ 人工裁决,共立案 20+ 项,修复 15 项,5 项有意保留(理由见下)。

## 方案取舍

### 已修复(选定方案)

| 问题 | 方案 | 理由 |
|---|---|---|
| 侧栏设置簇写死动作表(含 network-proxy 私有事件 topic 泄露进壳) | 新增 kernel/sidebarActions 注册表,壳只渲染注册表;network-proxy/git 自注册动作,删除事件总线绕行与占位动作(锁屏/运行时提示/Git Graph 假 toggle) | 与 filePanel「外壳不认识任何业务面板」同纪律;拔出插件 = 动作自动消失 |
| workspace 硬编码 `isPluginActive("session-budget")` 字符串门控 | 移除门控:预算数据归 kernel/settings,session-budget 只是编辑器,拔出编辑器不改变数据语义 | 插件自身头注释即自认「只是编辑器」;字符串 id 门控是插件间泄露 |
| editorCenter.tabContent 挂点无路由契约(5 个贡献全量挂载各自自查 null) | kernel/tabs 增 registerTabContent(kind) 路由注册表,EditorCenter 按 active.kind 取唯一组件并传 tab prop | 插座裁决渲染权,消灭「忘写 gate 渲染到别人 tab」的纪律约定;顺带切 tab 不再白挂 4 个组件 |
| PluginContext 自称「全部世界」但 filePanel/quota/fileVisual 走旁路注册 | ctx 统一:registerFilePanel/registerTabContent/registerFileVisual 进 PluginContext(host 委托);quota 折叠为 CliProfile.fetchQuota 能力字段由 host 自动接线 | settingsRegistry 是既有范式;quota 与 listSuggestions 同性质(声明式能力),5 个 registerXQuotaProvider 包装函数全删 |
| kernel/ipc.ts 混入 omp 私有命令 ompAuthCredential/ompAuthProviders | Rust omp_auth.rs 泛化为 sqlite.rs 只读 sqliteQuery 原语(READ_ONLY + 参数化);agent.db 路径/SQL 知识沉到 cli-shared/quota/ompAuth.ts | 内核只做代读原语,CLI 私有格式知识回缝隙层;附 Rust 测试锁只读语义 |
| Rust installer.rs 枚举全部 8 个 CLI 安装配方(新增 CLI 必改内核) | InstallPlan 参数化(npm/script 双通道),配方由前端 CliProfile 声明传入;删 CliInstallEngine 枚举 | 契约测试 installEngineContract.test.ts 的存在本身(防清单脱节)即是结构病信号,随枚举删除 |
| welcome/engineMeta.ts 静态表与 CliProfile 字段级重复 | CliProfile 增 docsUrl/npmPackage/scriptInstall 声明字段,engineMeta 改为 host.getCliProfiles() 派生 | 新增引擎改动面收敛为标准路径两处;引 AI 表 = 跨插件硬编码 |
| omp/pi 六件套逐行同构(pi 族薄壳 + rpcCommands 85%) | 上提 cli-shared/piFamily.ts 工厂(四件套 + edits 定位)+ cliQuery.createRpcSuggestionSource 工厂 | 2 家消费满足缝隙层准入;6 文件净减约 90 行 |
| cli-shared/fileIndex(零 CLI 格式知识、仅 composer 消费,违准入) | 移入 composer/triggers/,fuzzyFileScore 死转发删除 | 缝隙层只放 CLI 格式知识 |
| 边角料:死挂点 footer.*/leftRail/rightRail、panel-tab 拼 `${panel.id}` + `.git` 死 CSS、壳占位按钮 console.info、`../kernel/settings` 别名逃逸、grok 过期注释、vendors barrel 死再导出、welcome 两处 cli-shared import 缺声明 | 全部清理 | codemoss L3/L7 教训:僵尸声明与死代码即滞纳金 |

### 有意保留(被否决方案附理由)

| 问题 | 决定 | 否决理由 |
|---|---|---|
| fs.rs 删除白名单硬编码 8 家 CLI 目录 | 保留在 Rust | 这是不可信 renderer 面前的安全边界(纵深防御),放权前端 = 自毁;注释已声明同步义务 |
| path_cache.rs ~/.grok/bin、~/.hermes 兜底 | 保留 | 探针兜底性质(漏了只是探测不到),参数化需把 profile 知识穿透进会话 spawn 链,得不偿失 |
| AppShell/askWatch/Composer 对 kind==="ssh" 的 4 处字面量分支 | 保留 | kind 是 kernel 自有后端枚举(同 PTY),分支读的是内核契约而非插件私有语义;SessionMeta 加能力位需动 Rust serde,当前仅两种 kind,收益不抵 |
| kernel/ 顶层 75 条目扁平 | 暂不分组 | 纯目录搬移 = 全仓 import churn、零行为收益;改为在 AGENTS.md §1 立「内核准入」口径(宿主机制 + 跨插件契约,单插件语义不入)作为机器外防线 |
| cli-kimi/index.tsx 413 行 | 暂不拆 | 距 500 行铁则尚有余量;已在审查记录立案,触发铁则时按 omp/pi 先例拆 configStatus/sessions |

## 验证

- `pnpm typecheck && pnpm test`:780/780 绿(删除 1 个被架构修复消灭的契约测试
  installEngineContract.test.ts,新增 EngineCard 内联 meta);
- `pnpm check:arch-boundary && pnpm check:file-size`:通过(host.ts 压线 500 行);
- `cargo test && cargo clippy -- -D warnings && cargo fmt --check`:sqlite/installer
  新增 5 个 Rust 测试绿(只读拒写/参数化/计划构造/前端形状反序列化);
- `pnpm tauri:dev` 真实窗口目检:侧栏设置簇(齿轮菜单 = 注册表动作 + Git Graph
  / 网络代理钉住)、欢迎页引擎卡(派生元数据 + 探针)、中央 tab 路由均正常。
