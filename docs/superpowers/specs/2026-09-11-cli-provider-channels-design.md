# CLI 独立配置:供应商渠道(Provider Channels)

日期:2026-09-11
状态:设计定稿(待实现 + 真窗口目检,未提交)

## 背景与目标

`docs/design/cli-config-gui.html`(09-09 已落地)的「CLI 独立配置」设置页已能为
OMP / pi / Claude Code / Codex 四引擎提供 GUI 结构化编辑 + 原始编辑双模式。
效果示例(图2-3)要求在该页内新增**供应商渠道** section,目标:

1. 让 Claude Code 与 Codex 两个 tab 各持一份「供应商渠道」列表——每个渠道是
   `{ baseUrl, apiKey, model }` 命名预设,**点击行即激活,对新会话生效**,写各自原生配置。
   OMP tab 的供应商设置走独立设计(见下「OMP 供应商认证」):按用户 2026-09-11 截图对齐
   codemoss 的「供应商认证」(订阅授权 OAuth + API Key 写 agent.db),而非渠道预设。
2. 提供「导入 cc-switch」能力,把本机 `~/.cc-switch/` 已有渠道收纳成 tmd 渠道,
   cc-switch 标注为徽标。
3. 提供「添加/编辑/删除」与空态卡。
4. 不动 OMP / pi tab;其它三块独立能力(API Key 管理、models.yml 自定义供应商、
   订阅授权 OAuth)按本次会话结论留待 V2+。

「新会话生效」天然成立:各 CLI 进程在 spawn 时自行读自己的
`~/.claude/settings.json` / `~/.codex/config.toml`,tmd 不缓存配置——
切换 = 写盘,下一次 spawn 读到新值。

## 方案取舍

**选定:沿 cli-config 扩展点新增 `providerPanel` 可选槽 + cli-shared 格式库 + cli-shared UI 卡片
(claude/codex 复用),Rust 零改动。**

- `kernel/cliConfigRegistry.ts:CliConfigEntry` 加 `providerPanel?: () => ReactNode`——
  与既有 `rawEditor?: string` 同级的纯扩展位,内核不知「渠道」语义。
- 类型 / 存储 / cc-switch 解析 / 备份壳沉淀进 `src/plugins/cli-shared/providerChannels/`
  (叶子格式库,只 import @kernel);列表/对话框 UI 三件在
  `src/plugins/cli-config/providerChannels/`(页面 UI 所有者,消费 cli-shared 格式库),
  cli-claude / cli-codex 经 providerPanel 槽挂载该卡片。
- claude apply 复用现有 `cli-claude/configGui.ts` 的 `saveClaudeConfig` 行级合并逻辑,
  仅写 `ANTHROPIC_BASE_URL / ANTHROPIC_API_KEY / ANTHROPIC_MODEL` 三个 env 键
  (cc-switch 导入条目的 AUTH_TOKEN 已在导入时并入 apiKey 字段);
  渠道未定义的字段保留现状(model-only 渠道不清现有 endpoint/key),写盘前走共享备份壳。
- codex apply 用现有 `cli-codex/configGui.ts` 的 `setToml` 写顶层 `model`,
  并按需 upsert 托管段 `[model_providers.tmd_channel]` 与顶层 `model_provider`,
  三段写盘任一失败从 `.bak-tmd` 整体回滚(备份壳 = cli-shared `backup.ts`)。
- 渠道存储 `~/.tmd-cli/cli-channels.json`(经 `ipc.configHomeDir()` = `$HOME` 解析),
  结构 `{ version: 1, engines: { [engineId]: { providers: Record<id, Channel>, current: string|null } } }`,
  读写经 `fsReadFile / fsWriteFile`(已有通用原语,绝对路径合法)。

**否决 A:做成 CliConfigField 新 kind**。field 契约是「同步值进、值出」,承载不了
异步 store + 切换副作用;硬塞污染 field 抽象。

**否决 B:Rust 侧承担 provider_files.rs 等价**。tmd 架构铁律:CLI 私有格式读写只在插件侧,
Rust 只暴露通用原语;`cli-config/io.ts` + `fsWriteFile` 已足够,引新 Rust 模块是 reverse direction。

**否决 C:本期内一起做 API Key(agent.db / auth.json 写)+ models.yml 自定义供应商 + OAuth。
见「已知上限」。**

## 设计

### 数据模型(`providerChannels/types.ts`)

```ts
export interface Channel {
  id: string;            // 存储 map key
  name: string;
  remark?: string;       // 副标题文案之一
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  /** 来自 cc-switch 导入;手动创建 = undefined。 */
  source?: "cc-switch";
  /** cc-switch v3 db 主键;source=cc-switch 必填。 */
  ccsId?: string;
  /** 用户态持久化,不影响切换。 */
  createdAt: number;
}

export interface EngineChannels {
  providers: Record<string, Channel>;
  current: string | null;
}

export interface ChannelDoc {
  version: 1;
  engines: Record<string, EngineChannels>;
}
```

### 存储(`providerChannels/store.ts`)

- 文件路径:`${configHomeDir()}/.tmd-cli/cli-channels.json`(`.tmd-cli` 经 `ipc.configHomeDir()` 即 `$HOME` 拼出)。
- 读:`fsReadFile` → JSON.parse → 缺 `version` / 缺 engines → 视为空,无副作用。
  IO 错误三态:missing → 空;error → 抛错到 UI,显示「无法读取渠道文件,操作禁用」。
- 写:全量覆盖(避免行级 patch 在 JSON 上的复杂度;体积小),经 `fsWriteFile`,
  写前走 cli-shared `backup.ts` 的 `.bak-tmd` 备份壳(每路径每会话只备份一次,不滚存)。
- `current` 字段在「apply 写盘成功」之后才回写;apply 抛错 → store 不动 → 用户态不变。
- 测试:对纯函数 `parseChannelDoc(text) / serializeChannelDoc(doc)` 做 contract 测试,
  走 `cli-omp/configGui.test.ts` 同样「真实快照 + 恒等 round-trip」断言。

### UI(`src/plugins/cli-config/providerChannels/` 的 ProviderChannelsCard + ChannelRow + ChannelDialog)

按图2-3 像素复刻:

- 卡片头:`供应商渠道` + 灰色 hint「点击行即切换 · 对新会话生效」 + 右侧「导入 ccswitch」+「添加渠道」。
- 列表行(图2 行结构):`ChannelAvatar`(圆形背景 + engine 兜底图标;baseUrl 命中已知品牌时换品牌色)
  → `ChannelMain`(name + 可选 cc-switch 徽标 `Badge tone="warning">cc-switch</Badge>`
  → subtitle `remark · host(baseUrl) · model`,各部分可空,最后 join「·」)
  → `Switch`(与 row click 同步;命中为当前渠道)
  → `Pencil`(打开编辑 dialog)→ `Trash`(删除,需 armed 确认;**当前渠道删除按钮禁用**,沿 codemoss 纪律)。
- 空态卡(图3):`还没有自定义渠道` / `点击右上角「添加渠道」创建`。
- 错误态:ProviderChannelsCard 自带顶部 banner 区(沿用 `cli-config` 已有错误样式),
  失败时单行文案 + 关闭;非阻塞,可继续编辑其他渠道。
- 添加/编辑 dialog:`name(必填) / remark / baseUrl / apiKey(secret 控件) / model`,
  name 唯一性按 engine 维度;model 候选自动从 baseUrl host 命中已知前缀/兜底不限。

### cc-switch 导入(`providerChannels/ccswitch.ts`)
- 探测源(沿 codemoss 优先级):`~/.cc-switch/cc-switch.db`(v3 SQLite) > `~/.cc-switch/config.json`(v2 JSON)。
  都不存在 → 弹「未检测到 cc-switch 数据」轻提示,无操作。探测 = `fsCollectFiles` 列目录一次,不整读文件。
- v3 db 读:`ipc.sqliteQuery` 取 `SELECT id, name, settings_config, app_type FROM providers`,
  `app_type` 直读分组(codemoss ccs_app_key:claude/codex;grokbuild 等未接引擎跳过);
  老 schema 缺列时回退无该列查询 + settingsConfig 形状启发(ANTHROPIC_* → claude,
  OPENAI_* / base_url / model → codex)。`settings_config` 是字符串列 → `JSON.parse` 得 `settingsConfig`;
  解析失败 → 视为空对象,不阻断整批。tmd 已有 `sqliteQuery` 只读原语,无需新增 IPC。
- v2 JSON 读:`fsReadFile` → `JSON.parse` → 遍历 `apps.claude.providers`(object map 或 array 皆支持)、`apps.codex.providers`,
  转 `[(id, entry)]` 对。
- 归一(对每个 entry):
  - `id` = cc-switch 原 id;`name` = entry.name;`source = "cc-switch"`;`ccsId = id`;`createdAt = Date.now()`。
  - 摊平 `baseUrl` / `apiKey` / `model`:
    - claude:`baseUrl = settingsConfig.env?.ANTHROPIC_BASE_URL`;`apiKey = settingsConfig.env?.ANTHROPIC_AUTH_TOKEN ?? settingsConfig.env?.ANTHROPIC_API_KEY`;`model = settingsConfig.env?.ANTHROPIC_MODEL`。
    - codex:`baseUrl = settingsConfig.base_url ?? settingsConfig.baseUrl`;`apiKey = settingsConfig.env?.OPENAI_API_KEY ?? settingsConfig.auth?.OPENAI_API_KEY`;`model = settingsConfig.model`。
  - `raw` 原值保留到内部 channel 元数据(`settingsConfig` 字面量,供切换时完整套用)。
- 去重:store 中已有同 `ccsId`(同 engine 维度)的条目 → 更新其字段,**不动手工渠道**;
  新增条目入列表。结果回执:`{ added: N, updated: M, skipped: K }`(坏 entry / 重复 name / schema 不符 → skipped,计数显示)。
- 范围内:仅手动导入一次,无 mtime 指纹轮询 banner,无后台同步。spec 「已知上限」列出 codemoss 全套。

**claude apply**(`src/plugins/cli-claude/channelApply.ts`):
- `applyChannel(channel)` 读全局 `~/.claude/settings.json`(缺失按空对象起步),
  用 `loadClaudeConfig` 解出 values,把 `{ baseUrl, apiKey, envModel }` 三键设为 channel 值
  (渠道未定义的字段保留现状:model-only 渠道不清掉现有 endpoint/key,反之亦然),
  经 `saveClaudeConfig` 行级合并拿新 raw → `backupOnce(path)`(共享 `.bak-tmd` 壳)→ `fsWriteFile`。
- 合并无变化时写盘内容等价(可能顺带规整缩进/换行)。
- 失败(文件不可写 / 解析失败):抛错回 UI,current 不回写。

**codex apply**(`src/plugins/cli-codex/channelApply.ts`):
- `applyChannel(channel: Channel)` 读 `~/.codex/config.toml`:
  - 若 channel.model 非空 → `setToml(lines, "model", channel.model)`;若 channel.baseUrl 非空 →
    upsert `[model_providers.tmd_channel]` 段(name=channel.name;base_url=channel.baseUrl;
    wire_api="responses" 兜底)+ `setToml(lines, "model_provider", "tmd_channel")`;
    否则 model_provider 不动。
- 拼回 raw,与原文不同才写:`backupOnce(path)` → `fsWriteFile`。
- 若 channel.apiKey 非空:读 `~/.codex/auth.json`,JSON.parse → 合并 `{ OPENAI_API_KEY: channel.apiKey }`(已有键覆盖),
  JSON.stringify → 同上备份后写盘。auth.json 不可读 / 不存在 → 创建空对象起步。

### OMP 供应商认证(`src/plugins/cli-omp/` 内,omp 专属知识)

按用户 2026-09-11 截图对齐 codemoss「供应商认证」页,两段:

- **订阅授权**:8 个 OAuth 供应商(Claude Pro/Max、ChatGPT Plus/Pro (Codex)、GitHub Copilot、
  xAI、OpenRouter、Kimi Code、Z.AI、Google Code Assist)只读状态行——
  凭据表 `auth_credentials` 有对应 oauth 行 = 已授权。登录 = 开内置终端会话
  (`host.createShellSession`)并写入 `omp auth-broker login <loginArg>`(PTY Enter = CR),
  OAuth 流程由 omp CLI 自管,token 刷新不经 tmd。
- **API Key**:37 供应商目录(id/name/envVar/featured,对齐 pi v0.84.3 env map;
  github-copilot OAuth-only 不列;google-vertex ADC 不收录)。行 = 名称 + 环境变量名 +
  未配置/已配置 + 掩码 key(头 6 + ········ + 尾 4;!/$ 前缀原样)。设置 Key/编辑 =
  校验(目录内/非空/无换行)→ `DELETE` + `INSERT`(credential_type='api_key',
  data=`{"key":…}`)经内核通用 `sqliteExecute`(参数化单条,SQL 留插件侧);
  删除 = 删 api_key 行,仅剩 oauth 行时报错指引 `omp auth-broker logout`。
   featured 16 项默认展示,其余折进「显示全部 37 个供应商」;筛选框按名称/环境变量过滤。
   品牌 logo 用 @lobehub/icons-static-svg 静态资产(vite 按 import 打包为 data URL,
   零运行时;icon=null 走首字母兜底头像)。oauth data 带 refresh 字段的状态行显示
   「已授权 · 自动刷新」。目录外但有 api_key 凭据的 provider(omp 计划供应商,如
   minimax-code-cn / zhipu-coding-plan)自动补 configured 行置顶展示——保证
   面板可见凭据数与 omp 自报的 auth 计数一致。
- 读快照错误语义:库缺失 = 全目录未配置;表缺失(omp 未首跑)= 友好提示;其余读错误上抛。

- **自定义供应商(models.yml)**:摘要行(名称/baseUrl/api 协议/模型数/含 Key)+
  「添加供应商」GUI 表单(名称/API 地址/协议四枚举/API Key 可空建议 $ENV/模型一行一个;
  重名与形状校验,纯函数插入 providers 块尾,.bak-tmd 备份壳)+ 「编辑配置」原文编辑器
  (全文覆盖,.bak-tmd 备份壳;文件缺失以模板种子)。单条删除/高级字段走原文编辑器。
  摘要走 indent 扫描纯函数(kernel yamlBlocks 的 getList 会把 models 内嵌 `- text`
  误计入,故 models 数按 `- id:` 精确数)。不做 YAML 语义校验:omp 启动自检报错,
  编辑器保留原文可回改(已知上限)。

**omp 设计变更记录**:首版把 OMP 渠道做成 modelRoles.default 预设切换,大仙 2026-09-11 目检
否决——OMP 供应商设置应按 codemoss「供应商认证」形态(本节)。已拆除 modelRoles 渠道实现,
切换语义回到 claude/codex 渠道;agent.db/models.yml 深管按本节落地(API Key 部分)。

**新会话生效**:tmd `sessionSpawn` 不缓存 CLI 配置,spawn 时 CLI 自身读各自的文件
(`configStatus.ts:33-39` 仅显示时读,作面板种子,不参与 spawn),文件被改 → 下次 spawn 即读到新值。
已运行会话不受影响(本设计目标,符合效果示例文案)。

### 注册

`cliConfigRegistry.ts` CliConfigEntry 新增字段:

```ts
/** 字段表单下方的附加面板(如供应商渠道);组件可读 sources()/current 实现切换。 */
providerPanel?: () => ReactNode;
```

`plugins/cli-config/CliConfigTab.tsx` `EnginePane` 在 ConfigForm 之下渲染
`engine.providerPanel?.()`(有则渲染,无则不出现)。

claude / codex 插件注册:
```ts
registerCliConfig({
  ...claudeConfigEntry,
  providerPanel: () => <ProviderChannelsCard engineId="claude" apply={applyChannel} />,
});
```

### 文件清单

新建(cli-shared 格式库,叶子,只 import @kernel):

- `src/plugins/cli-shared/providerChannels/types.ts`
- `src/plugins/cli-shared/providerChannels/store.ts`(`parseChannelDoc / serializeChannelDoc / loadChannelDoc / saveChannelDoc / upsertChannel / removeChannel / setCurrent / genChannelId`)
- `src/plugins/cli-shared/providerChannels/backup.ts`(`.bak-tmd` 备份壳:`backupOnce / restoreFromBackup`,channelDoc + claude/codex apply 三消费方)
- `src/plugins/cli-shared/providerChannels/ccswitch.ts`(解析纯函数 + `readCcSwitchV2/V3` IO + `probeCcSwitch` 目录探测)
- `src/plugins/cli-shared/providerChannels/index.ts`(barrel + 文件头准入声明)

新建(cli-config 页面 UI,消费 cli-shared):

- `src/plugins/cli-config/providerChannels/ProviderChannelsCard.tsx`(列表卡 + 增删改/切换/导入 handler)
- `src/plugins/cli-config/providerChannels/ChannelRow.tsx`(单行,纯展示 + 行为转发)
- `src/plugins/cli-config/providerChannels/ChannelDialog.tsx`(添加/编辑;复用 git 插件 GitDialogShell 通用骨架)
- `src/plugins/cli-config/providerChannels/index.ts`(barrel,供 claude/codex 挂 providerPanel)

新建(插件侧 CLI 原生写盘):

- `src/plugins/cli-claude/channelApply.ts`
- `src/plugins/cli-codex/channelApply.ts`
- `src/plugins/cli-omp/providerAuthCatalog.ts`(OAuth 8 行 + API Key 37 供应商静态目录,品牌 logo 资产映射)
- `src/plugins/cli-omp/modelsConfig.ts`(+`.test.ts`;models.yml 摘要/插入纯函数 + 读/存 + 模板种子 + GUI 添加校验)
- `src/plugins/cli-omp/OmpCustomProviderDialog.tsx`(「添加供应商」表单弹窗)
- `src/plugins/cli-omp/providerAuth.ts`(listOmpAuth / setOmpApiKey / deleteOmpCredential + maskKey/validateApiKey/buildAuthIndex 纯函数)
- `src/plugins/cli-omp/OmpProviderAuthPanel.tsx` + `OmpOauthSection.tsx` + `OmpKeyDialog.tsx` + `OmpModelsConfigSection.tsx`(供应商认证面板四件)
- `src/plugins/cli-omp/providerAuth.test.ts`(纯函数测试)

测试:

- `store.test.ts`(round-trip + 边界)、`ccswitch.test.ts`(v2 json + v3 row + appType 直读 + 坏 entry 跳过 + 去重)。
- `cli-claude/channelApply.test.ts`(saveClaudeConfig onlyChanged 性质下的 env merge 语义)。
- `cli-codex/channelApply.test.ts`(行级补丁 + provider 段 upsert 保留其它段 + auth.json merge + 坏 JSON 起步)。

修改:

- `package.json`:`+@lobehub/icons-static-svg`(纯静态 svg 资产包,方案取舍见上;非框架/状态库/UI 库)。
- `src/kernel/cliConfigRegistry.ts`:`CliConfigEntry` +`providerPanel?: () => ReactNode`。
- `src/plugins/cli-config/CliConfigTab.tsx`:`EnginePane` 内 ConfigFile 之后渲染 providerPanel。
- `src/plugins/cli-config/providerChannels/ChannelDialog.tsx` 复用的 `FieldControls.SecretInput` 原在同插件,变内聚。
- `src/plugins/cli-codex/configGui.ts`:`getToml/setToml` 加 export(同插件 channelApply 复用)。
- `src/plugins/cli-claude/index.tsx` / `src/plugins/cli-codex/index.tsx`:注册时 +`providerPanel`。

## 验证

1. `pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`。
2. 纯函数测试(`vitest`,与源码同目录共置):
   - store:空 doc → 解析空;坏 JSON → 抛;序列化恒等。
   - ccswitch:v2/v3 双源 fixture 解析;坏 settings_config 跳过不阻断;去重(case-by-case 验证 added/updated 计数)。
   - claude apply:identity(`saveClaudeConfig ∘ loadClaudeConfig = id`) 不破;env merge 只写变过键;空 channel = no-op。
   - codex apply:`setToml/getToml` 不可破坏现有 [model_providers.*] 段;有 baseUrl 时 upsert tmd_channel 段 + model_provider 键;apiKey 写 auth.json;失败回滚(单元层断言回滚后内容 = 原始)。
3. 浏览器桩目检(`pnpm dev` 1421,沿 #15 桩配方):打开设置页 → CLI 独立配置 → Claude Code 引擎 tab →
   - 空态卡正确渲染;
   - 添加渠道 → 行出现(头像 + name + 副文 + 开关 + pencil + trash);
   - 点击行 → 桩捕获 `fsWriteFile` 调用 → 内容含 ANTHROPIC_BASE_URL 等键;
   - 导入 ccswitch(桩内 `fsReadFile ~/.cc-switch/config.json` 回 fixture)→ 行出现并带 cc-switch 徽标;
   - 编辑 / 删除 行 正确刷新;空状态、busy 状态、自家后台 IO 错误态文案正确。
   同样四流对 Codex tab 跑一遍;OMP / pi tab 不渲染 providerPanel(断言 DOM 不含 `provider-panel`)。
4. `pnpm tauri:dev` 真窗口目检:在 OMP/pi tab 视觉无变化;Claude/Codex tab 看到渠道列表;
   至少对一个 claude 渠道真激活 → 用 `cat ~/.claude/settings.json` 核对三个 env 键落地;
   反复切回空态 → `.bak-tmd` 不滚存(沿 io.ts 纪律);删除当前渠道 = 按钮禁用。

## 已知上限(V2+ 候选,本期不做)

- **pi 渠道真切换 / pi 供应商认证**:pi 走 `auth.json`(0600),本期 pi tab 不渲染
  providerPanel;复用 omp 面板结构时需先补 0600 权限原语(auth.json 由 tmd 新建时无法 chmod)。
- **自定义供应商(OMP `models.yml` 读写)**:无 YAML 库,需新写行级补丁,留 V2。
- **停用 pseudo 行 / 拖拽排序 / 同步 banner 轮询 / 自动 prune**:
  codemoss 全套;本期内仅手动按钮导入。
- **删除当前渠道恢复官方配置**:codemoss 在删 current 时恢复 backup snapshot;
  本期简化 = 删除时仅清 `current`,配置保持最后激活状态(用户可走原始编辑恢复)。
- **新建 / 切换失败时的回滚 UI 反馈**:本期仅抛错到 banner。

## 关联

- 效果样例:用户截图 2026-09-11,图2-3 = 渠道列表 + 空态;图4 = codemoss 完整 omp 参照页(超出本期范围)。
- 现状 GUI 页:docs/design/cli-config-gui.html + src/plugins/cli-config/ + 09-09 cli-gui-config 提案。
- 跨插件契约:src/plugins/cli-shared/(≥2 cli-* 消费方准入)。
