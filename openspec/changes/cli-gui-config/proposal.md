# CLI 独立配置 提案(cli-gui-config)

日期:2026-09-09 · 状态:已实现,待大仙审核(未提交)
原型:`docs/design/cli-config-gui.html`(浅色,对齐客户端)

## Why

各 CLI 的个性化配置散落在自家格式的磁盘文件里(omp 的 `~/.omp/agent/config.yml`、pi 的 `~/.pi/agent/settings.json`、claude 的 `~/.claude/settings.json`、codex 的 `~/.codex/config.toml`),改一处要记命令、查文档、手编磁盘。目标:设置页新增「CLI 独立配置」模块,图形化读写这些文件;能力按引擎归属 —— 每家 CLI 的配置知识写进对应 cli-* 插件,宿主只做注册面与通用渲染。

## 方案取舍

**模块归属(四选一):**

- **A(选定)kernel 注册表 + cli-config 聚合插件**:kernel 新增 `cliConfigRegistry.ts`(镜像 settingsRegistry,~40 行)+ `PluginContext.registerCliConfig` 注册面;新 feature 插件 `cli-config` 注册设置 section「CLI 独立配置」,按注册表渲染引擎子 tab 与通用表单;各 cli-* 插件经 ctx 贡献 `{schema, load, save}` 纯函数。新增引擎配置能力 = 只改自家插件目录,cli-config 与 kernel 零改动(注册表驱动,同 welcome 引擎卡逻辑)。
- B(否)每家 cli 插件各自 `registerSettingsSection`:左导航爆出 N 个引擎项;表单/保存/备份逻辑各家重复。
- C(否)改造 settingsRegistry 支持多插件合并 tabs:动「重复 id 抛错」既有契约,影响存量 4 个 section,收益仅本特性。
- D(否)cli-config 直接 import 各家组件聚合:插件间 import 耦合,违背「贡献一律经 ctx 注册面」;新增引擎要改两处。

**写回策略(核心风险决策):**

- YAML/TOML(omp/codex):**行级补丁** —— 已托管键原行替换、缺失键在正确位置插行,其余字节原样保留。禁止 parse→reserialize 整文件:codex config.toml 实证 236 行,`[projects]`/`[mcp_servers]`/`[plugins]`/`[desktop]` 等托管段与手写注释会被整段毁掉;omp config.yml 的 provider 密钥段同理。
- JSON(pi/claude):`JSON.parse` → 浅合并已托管键 → `stringify`;JS 对象保序、纯 JSON 无注释,安全。claude 的 hooks/permissions 等未托管键原样保留。
- 备份:每个配置文件在 GUI 会话内首次写盘前复制 `<file>.bak-tmd`(对齐 omp 自身 `.bak-pre-magic-context` 先例)。
- 解析失败/文件缺失:该引擎 tab 显错误条 + 「在文件管理器中显示」(`fsRevealInFileManager`),拒绝写入,不做猜测兜底(对齐「内核不猜 CLI 私有格式」铁律)。
- IO 全走既有通用原语(`ipc.configHomeDir`/`fsReadFile`/`fsWriteFile`),**零 Rust 改动**。

**控制面形态:** 声明式 schema(text/select/toggle/secret + 两个复合型:`modelMap` 键值角色表(角色→模型+思考强度,用于 omp modelRoles)、`orderedList` 有序串链(用于 fallbackChains / webSearch.providerChain))+ `load(rawText)→values` / `save(rawText,values)→newText` 纯函数,格式知识全部留在插件侧(纯函数好单测);复合控件的渲染逻辑内置于 cli-config,不属于任何单插件。entry 可声明 `rawEditor` 语言:引擎 tab 顶部「GUI / 原始」双模式,原始模式用现成 CodeMirror 组件(kernel/cmEditor,files 编辑器同源)提供全量键逃生舱,与 GUI 共用同一保存/备份通道。

**section 结构实现:** cli-config 注册的 section 只含一个 tab,引擎切换是 tab 内的子 tab 条(样式对齐 section tabs),由 `useCliConfigEntries()` 订阅驱动 —— 规避插件激活顺序耦合,注册表保持最简。

## What Changes

- **kernel**:`cliConfigRegistry.ts`(条目:id/title/icon/order/fields(含复合型 modelMap/orderedList)/file 或 files(多配置源)/load/save/rawEditor)+ `plugin.ts` 增 `registerCliConfig`;单测覆盖重复 id 抛错与排序。
- **新插件 `plugins/cli-config`**:注册 section `cli-config`「CLI 独立配置」;通用表单渲染(text/select/toggle/secret/说明行/advanced 折叠)+ 复合控件(modelMap 角色表增删行、orderedList 有序链增删排序)+ GUI/原始双模式(CodeMirror)+ 配置源切换(全局 / 活跃工作区项目级)+ IO 壳(读文件 → load → 脏跟踪 → save → 首写备份 → 写盘 → toast)+ 错误态/文件缺失空态。
- **cli-omp** `configGui.ts`(专业版,对齐 omp 15+ 配置段):模型角色表(modelRoles 全角色,值 = provider/model:思考强度,候选行级解析 `models.yml`)、回退链(retry.modelFallback + fallbackChains 按角色)、思考与生成(defaultThinkingLevel / symbolPreset / prewalk.enabled)、能力开关(compaction / memory.backend off|local|mnemopi / checkpoint / security / ttsr 高级折叠)、webSearch.providerChain;行级 YAML 补丁;声明 `rawEditor: yaml`。已有 `configStatus.ts` 行级解析先例复用其风格。
- **cli-pi** `configGui.ts`:defaultProvider(下拉,来自 `models.json` providers 键)、defaultModel(随 provider 过滤)、defaultThinkingLevel、theme;JSON 合并。
- **cli-claude** `configGui.ts`:model、alwaysThinkingEnabled、includeCoAuthoredBy、env 七键(ANTHROPIC_BASE_URL / ANTHROPIC_API_KEY(secret) / ANTHROPIC_MODEL / DEFAULT_{OPUS,SONNET,HAIKU}_MODEL / API_TIMEOUT_MS,高级折叠);JSON 合并。
- **cli-codex** `configGui.ts`:model、model_provider、model_reasoning_effort、web_search、disable_response_storage、service_tier;TOML 顶层平面键行级补丁;tab 顶部内置托管段警示条。
- **注册**:四个 cli 插件 activate 各加一次 `ctx.registerCliConfig(...)`;`allPlugins` 加 cli-config 一行。
- **不做**(v2 候选,按同一契约逐家补):env 任意键值表、hooks/permissions/MCP 图形管理、omp providers 可见性(path-scope 清单,语义坑最深)与 auth-broker 多账号轮换、保存前 diff 预览、凭据区(auth.json/models.yml 密钥编辑)、SSH 远端机器配置、其余引擎(kimi/grok/qoder/opencode/dsh)。

## 字段映射(实证本机真实配置,2026-09-09)

| 引擎 | 文件 | 控件 → 磁盘键 | 写回 |
|---|---|---|---|
| omp | 全局 `~/.omp/agent/config.yml` + 项目级 `<workspace>/.omp/config.yml` | modelRoles 角色表(全角色);retry.modelFallback + fallbackChains;defaultThinkingLevel / symbolPreset / prewalk.enabled;compaction / memory.backend / checkpoint / security / ttsr×4;webSearch.providerChain;原始 YAML 模式全量 | 行级 YAML 补丁 |
| pi | `~/.pi/agent/settings.json` | defaultProvider / defaultModel / defaultThinkingLevel / theme | JSON 合并 |
| claude | `~/.claude/settings.json` | model / alwaysThinkingEnabled / includeCoAuthoredBy;env.BASE_URL / API_KEY(secret) / ANTHROPIC_MODEL / DEFAULT_*×3 / API_TIMEOUT_MS | JSON 合并 |
| codex | `~/.codex/config.toml` | model / model_provider / model_reasoning_effort / web_search / disable_response_storage / service_tier | TOML 顶层平面键行级补丁 |

注意:omp 思考强度存在「角色后缀优先于顶层 `defaultThinkingLevel`」的双写语义(本机实证两者并存),v1 只写角色后缀、不碰顶层键,实际优先级以实施时 omp 文档/实测校准为准。

omp 专业面依据:`docs/research/omp-cli-course/`(第 1/6 课 modelRoles 9 角色与 fallbackChains、第 5 课 memory 三后端、第 9 课 ttsr、第 7 课 webSearch)+ 本机 `omp --help`(prewalk / 角色 flag)。角色枚举与 ttsr 取值以实施时 `omp config get modelRoles` 实测校准;项目级 overlay 语义 = 数组段整体替换(覆盖全局),GUI 内嵌提示。

## 验证

- 单测:四家 load/save 用真实文件快照 fixture,断言「已托管键更新 + 未托管字节逐字保留」(codex 样本必须含 `[projects]` 注释段;omp 样本含 retry/dev 段、modelRoles 多角色与链表增删排序往返)。
- 桩目检:浏览器桩 Tauri IPC(configHomeDir/fsReadFile/fsWriteFile)驱动四 tab 读写往返、脏跟踪、备份生成、错误态。
- 全链:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build` + `pnpm tauri:dev` 真窗改真实配置回读核对。
