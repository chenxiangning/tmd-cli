# MCP Hub 插件:跨引擎 MCP 配置写回管理 + 三源商店 + 导入桥

> 日期:2026-09-28 · 状态:已实现(1421 桩目检九路径过:面板/三视图/引擎栏/卡片/编辑弹窗/.bak-tmd 备份先写/三源商店含 Glama 401 空态/导入冲突标记/测试徽标;react-doctor 修至 100;真机 tauri:dev 端到端留大仙复验)
> 并行约束:与 `2026-09-28-skill-hub-plugin` 并行执行,冲突面协调见 §6,两提案本节一致。

## 实现纪律(最高优先)

三方开源客户端(MIT)只提供**交互形态与商店契约**参考。**实现一律按本提案记录的公开 API 契约与行为语义自研重写,禁止逐字移植其代码;仓内代码、注释、文档不得出现该项目名或其仓库名**。外部服务(MCP official registry / Smithery / Glama)是公开第三方服务,名称照常使用,无争议。存储模式遵循上游调研结论:**tmd 不做 MCP 真相源、不做 MCP 客户端;读聚合 + 按方言写代理,真相源永远是各家 CLI 自己的配置文件**。

## 1. 背景与目标

tmd-cli 的 MCP 只读发现链已落地六家(`cli-shared/mcpFormat.ts`:JSON `mcpServers` 家 omp/kimi/qoder + TOML `[mcp_servers.*]` 家 codex/grok,claude 走 `~/.claude.json` 顶层;composer 抽屉 MCP 分区已落地),点击只能 send 面板命令或展示性 insert。缺统一管理面:增删改查各家 MCP server 配置、从官方 registry/Smithery/Glama 商店一键安装、从本机其他工具(Claude Desktop 等)导入、连通性测试(上游调研 §4 否决 C 明确保留的唯一例外:一次性 stdio `tools/list` 冒烟探活)。

目标 = 新插件 `mcp-hub`:右栏工具栏入口,点开在中央 tab 区管理。**存储模式 = 写回各家 CLI 自己的配置文件,引擎直接生效、零迁移**。kernel 零改动;Rust 侧仅新增一个一次性连通测试命令。

## 2. 范围边界

| 面 | 做 | 不做(去向) |
|---|---|---|
| P3 配置管理 | 六家引擎(omp/kimi/qoder/codex/grok/claude)server 增/删/改(写回原文件)、原始文件预览、编辑弹窗(transport 三型字段集) | opencode(键名不同:`mcp` 段 type:local/remote)、dsh(Cordis YAML patch 形状)、pi(核心无 MCP,靠 pi-mcp-adapter 扩展;管理页对 pi 显式显示「—(靠扩展)」,不猜测)——三家后置;enabled/disabled 开关(各家方言不一,语义 = 存在即启用,删 = 卸);项目级 overlay(全局级先行);claude `projects.<cwd>` 嵌套(P5 后置可选) |
| P4 商店 | official/Smithery/Glama 三源浏览搜索 + 安装草稿弹窗({VAR} 模板填空)→ 写回目标引擎 | OAuth 2.1 授权流(各家方言 + DCR 范围大;需要 token 的 server 用户手填 headers);评分/评论(上游无数据) |
| P5 导入桥 | 扫本机其他工具 MCP 配置勾选导入;连通测试(stdio = Rust 一次性握手;http/sse = 前端握手) | 长驻 MCP client / call_tool(上游调研否决 C:模型侧消费者是 CLI,tmd 起的进程模型看不见,纯负收益);MCP 进程管理面板 |
| CLI 子命令写通道 | 后置增强(见 §3) | 首版全走文件合并写 |

## 3. 方案取舍

| 决策 | 选定 | 否决与理由 |
|---|---|---|
| D1 存储 | **写回模式**:直接读写各家 CLI 配置文件(上游调研选定;与 tmd-cli 多 CLI 宿主定位一致,cli-config 插件先例) | 自有存储 + 导出(双真相源漂移,上游调研否决 A);混合双真相源(过度工程) |
| D2 写通道 | 统一文件合并写(六家格式知识集中 `mcpWrite.ts`,行为确定、可纯函数测试) | 上游调研建议的「子命令优先」(`claude mcp add-json` / `codex mcp add` / `grok mcp add`)**列为后续增强**:子命令本质也是往同一文件写,却引入 spawn 交互、超时与错误面;首版统一文件写保测试性与一致性,格式知识两方案都要有,后切换无损 |
| TOML 写回 | 行级段操作(定位 `[mcp_servers.x]` 段界整段替换/删除;新增 = 文件尾追加) | toml crate 全量 parse/serialize(丢格式与注释;config.toml 是用户重要配置,不可接受) |
| JSON 写回 | 全量 parse/stringify(2 空格缩进,未知键原样保留) | 行级 patch(JSON 无注释,全量安全) |
| 写回安全 | **`.bak-tmd` 备份纪律**(上游调研明确:写前落同目录 `<file>.bak-tmd`,复用 cli-config/io.ts 先例);序列化失败 = 不写 | 仅内存快照(进程崩溃即丢原文件;.bak-tmd 是本仓既有写安全标准) |
| 写适配器归属 | CliProfile 声明式贡献点(同 `listMcpServers` 先例:各 cli-* 插件声明自家的读写适配器;未声明 = 该引擎无此能力,mcp-hub 不猜) | mcp-hub 内 `serverFiles.ts` 集中持有十家路径(与声明式架构相悖,路径知识重复漂移) |
| 连通测试 | `mcp_probe` 单命令(stdio:Rust 内 spawn → initialize → tools/list → kill 一次性;上游调研保留的唯一探活例外);http/sse 前端 quotaFetch 握手 | 长驻 session 三件套(一次性动作,长驻注册表过度);Rust 泛化 http 测试(前端已能做) |
| server 模型 | 原生形状透传(每家存自己方言:command/args/env 或 url/headers;不造统一抽象) | 统一抽象模型(方言丢失,写回还原难) |
| 密钥展示 | env/headers 疑似密钥值脱敏显示(对齐 settingsRelay sanitize 纪律;上游调研 §7) | 明文回显(泄漏面) |
| 代码来源 | 按公开契约自研重写 | 逐字移植参考实现(用户要求仓内零该项目名) |

## 4. 设计

### 4.1 插件形状与入口

- `src/plugins/mcp-hub/`,`allPlugins` 注册一行。
- `ctx.registerFilePanel({ id: "mcp-hub", label: "MCP", icon, component: McpHubPanel, showFileSubbar: false })`:右栏概览(每引擎一行:名称 + server 计数;底部「打开管理」按钮)。
- `ctx.registerTabContent({ kind: "mcp-hub", component: McpHubTab })`;`openTab({ id: "mcp-hub", kind: "mcp-hub", title: "MCP" })` 幂等单例。
- 图标不与现有右栏面板及 composer 唤醒图标撞形。

### 4.2 文件清单(全部 ≤300 行,超限即拆)

```
src/plugins/mcp-hub/
  index.tsx              插件入口:注册面
  hubTab.ts              openMcpHubTab 契约
  McpHubPanel.tsx        右栏概览面板
  McpHubTab.tsx          中央 tab 壳:左引擎栏 + 视图切换(server/商店/导入)
  ServersView.tsx        server 卡片列表(名称/transport/command/url 徽标 + 测试按钮)
  ServerEditModal.tsx    编辑弹窗(ServerDraft,见 4.4)
  RawFilePreview.tsx     原始文件只读预览(附「在文件 tab 打开」)
  registrySources.ts     三源 API client(quotaFetch)
  registryNormalize.ts   卡片归一 + 安装草稿生成({VAR} 模板系统)
  StoreView.tsx / StoreCard.tsx        商店视图(源切换/搜索/卡片)
  InstallDraftModal.tsx  安装草稿弹窗:模板填空 + 目标引擎 + 落位预览
  importScan.ts          P5 外部配置扫描(路径集 + transport 推断)
  ImportView.tsx         导入视图:勾选导入(冲突默认跳过可勾覆盖)
  probe.ts               连通测试编排(stdio → Rust;http/sse → 前端握手)
  locales/en.ts, locales/ja.ts
```

各 cli-* 插件侧:新增自家写适配器声明(经 CliProfile 贡献点,复用既有 `listMcpServers` 所在声明机制;执行时以 CliProfile 现状为准接入),写实现调 `cli-shared/mcpWrite.ts`。

### 4.3 各家配置文件与格式(读面复用既有六家适配器)

| 引擎 | 文件 | 格式 | 读 | 写 |
|---|---|---|---|---|
| omp | `~/.omp/agent/mcp.json`(缺则 `.mcp.json`) | JSON `mcpServers` | 既有适配器 | mcpWrite JSON |
| kimi | `~/.kimi-code/mcp.json`(cli-kimi 已声明) | JSON `mcpServers` | 既有适配器 | 同上 |
| qoder | `~/.qoder/shared_client/mcp.json` | JSON `mcpServers` | 既有适配器 | 同上 |
| codex | `~/.codex/config.toml` | TOML `[mcp_servers.*]` | 既有适配器 | mcpWrite TOML 行级 |
| grok | `~/.grok/config.toml`(cli-grok 已声明) | TOML | 既有适配器 | 同上 |
| claude | `~/.claude.json` 顶层 `mcpServers` | JSON | 既有适配器 | mcpWrite JSON(全量,未知键保留) |

写前逐家核对磁盘实证(上游调研 §3.2 矩阵),出入以磁盘为准。文件不存在 = 该引擎区显示「尚未创建」,JSON 家首次保存即建;TOML 家(codex/grok)config.toml 缺失 = 不显示该引擎,不替用户造整个 config。

### 4.4 ServerEditModal(ServerDraft 字段集)

- id(server 名,同文件内唯一,必填);transport 三选互斥:stdio / http / sse。
- stdio 组:command(必填)/ cwd / args(每行一条)/ env(k=v 每行,**值列默认掩码显示,聚焦显明文**——密钥脱敏纪律)。
- remote 组:url(必填)/ headers(k=v 每行,同掩码)。
- 保存 = 读原文 → 落 `.bak-tmd` → mcpWrite upsert → 写回;写回后 diff 实证仅目标段变化(TOML 注释保留)。写后提示语不承诺生效时点(「下次会话生效」措辞,上游调研 §7)。
- 编辑期原文快照驻内存,cancel 即弃;id 改名 = 删旧 + 增新。

### 4.5 cli-shared/mcpWrite.ts(新,缝隙层准入)

头注释:与 `mcpFormat.ts` 同一格式域先例(JSON `mcpServers` 三家 + TOML `[mcp_servers.*]` 两家);消费方 = 各 cli-* 插件写适配器(mcp-hub 经贡献点路由)。

- `writeJsonMcpServers(rawText, servers)` / `removeJsonMcpServer(rawText, name)`:JSON.parse(失败抛错,UI 显错误态拒写)→ 替换/删顶层 `mcpServers`(无则新增)→ stringify(2 空格,末尾换行);其他键原样保留。
- `upsertTomlMcpServer(rawText, name, entry)` / `removeTomlMcpServer(rawText, name)`:定位段头到下一段头/EOF 为段界,整段替换或删除;新增 = 文件尾追加段;entry 序列化覆盖 command/args/env 常见形状(标量/数组/内联表,字符串引号转义);其他段与注释原样保留。
- 单测矩阵:JSON 未知键保留/解析失败拒写;TOML 注释保留/段替换/尾追加/env 内联表/引号转义/删段。

### 4.6 三源 registry 契约

- official:`https://registry.modelcontextprotocol.io/v0.1`(servers + packages);卡片归一(name/description/repo);有 package 指引的 stdio 型 → manualDraft(command 建议 = 包名,用户确认)。
- Smithery:`https://api.smithery.ai`(搜索 + 详情);create config 的 JSON Schema → ConfigInput(env 型)。
- Glama:`https://glama.ai` API;卡片含 tools 数。
- 统一 `McpRegistryCard { source, id, name, description, url?, installDraft?, manualDraft?, configInputs[] }`;installDraft = 可直接生成的 server 配置(模板含 `{VAR}` 占位),manualDraft = 需手填。
- 模板系统:扫 draft 的 url/command/args/headers 中 `{NAME}` 占位 → 必填 ConfigInput 列表(target: url/env/header/argument);用户填值后替换占位生成最终配置。
- 网络全走 `ipc.quotaFetch`;单源不可达 = 该源空态 + 错误提示,不白屏;会话内存缓存 + 手动刷新按钮(不做落盘缓存)。

### 4.7 P5 导入桥扫描集

- `~/.claude.json`(顶层 `mcpServers`;`projects.<cwd>` 嵌套后置)、`~/.mcp.json`、`~/.codex/config.toml`、Claude Desktop 配置(macOS `~/Library/Application Support/Claude/claude_desktop_config.json`;win/linux 路径执行时按平台补)、`~/.codebuddy/mcp.json` + 手选任意文件(JSON `mcpServers` 或 TOML)。
- transport 推断:显式 type 优先;缺省 command → stdio / url → http。同名多源保留首个;importable = 目标引擎尚无同 id(可勾覆盖);导入 = 深拷贝经 mcpWrite 写入目标引擎(同样走 `.bak-tmd`)。

### 4.8 连通测试

- stdio:Rust 新模块 `src-tauri/src/mcp_probe.rs`(~120 行):`mcp_probe(command, args, env, timeout_ms = 15000) -> { ok, server_name?, server_version?, tools_count?, error? }`;内部 spawn → initialize(协议版本自新向旧候选尝试)→ tools/list → kill;失败附 stderr 尾 5 行。一次性命令,无常驻 session。
- http/sse:前端 quotaFetch POST initialize(Accept: application/json, text/event-stream)应答即判可达;sse 事件流订阅不做。
- 结果 = server 卡片行内徽标(工具数/延迟/错误);测试不产生任何持久状态。

### 4.9 Rust 改动面

仅 `mcp_probe.rs` + `lib.rs` generate_handler +1 行 + `src/kernel/ipc.ts` +1 方法(`mcpProbe`,插 quota/sqlite 区段后,守并行纪律)。Cargo.toml 零改动。

## 5. 验证

- 单测:mcpWrite(JSON/TOML 矩阵)、registryNormalize(模板解析/三源归一)、importScan(路径集桩/transport 推断)、probe 编排、密钥脱敏(值掩码断言)。
- 门禁:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`;Rust 改动加 cargo test + clippy + fmt;`npx react-doctor@latest -y` 达 100。
- 写回安全实证:保存前后 diff 原文件,非目标内容零变化(TOML 注释逐行保留;JSON 未知键保留);`.bak-tmd` 落盘与恢复断言。
- 桩目检(1421):右栏图标与面板、tab 三视图、引擎栏、server 列表、编辑弹窗保存(fs 桩断言写回载荷 + 掩码)、商店三源切换、草稿填空、导入勾选、测试徽标。
- 真机 `pnpm tauri:dev`:omp 全局 mcp.json 增一个 server → omp 会话内 `/mcp` 面板可见该 server(端到端);codex config.toml 写回后 git diff 仅目标段变化;留大仙复验。

## 6. 并行执行协调契约(与 skill-hub 插件,两提案本节一致)

| 冲突文件 | 纪律 |
|---|---|
| `src/plugins/index.ts` | 各自 +1 import +1 数组项;skill-hub 项插数组现有尾之后,mcp-hub 项插 skill-hub 之后(对方行尚不存在则尾插;发现对方已改,重读再插,勿动对方行) |
| `src/kernel/ipc.ts` | skill-hub 方法插 fs 族封装之后;mcp-hub 方法插 quota/sqlite 区段之后(不同区域,锚点独立;锚点漂移 = 重读再改) |
| `src-tauri/src/lib.rs` | generate_handler 各自追加;skill-hub 2 行在前、mcp-hub 1 行紧后(同 index.ts 纪律) |
| `src-tauri/Cargo.toml` | 仅 skill-hub 改(+zip);mcp-hub 零改动 |
| `cli-shared/` | mcp-hub 新增 `mcpWrite.ts`;skill-hub 若扩 `skillDirs.ts` 只做加法并注释声明先例;互不相交 |
| 各 cli-* 插件 | 仅 mcp-hub 触碰(写适配器声明);skill-hub 不动 cli-* 目录 |
| `docs/README.md` | 各登记自己的索引行,行序无要求 |
| 其余 | 各自新增文件互不相交;禁 import 对方插件目录;事件前缀 `skillhub:` / `mcphub:`;持久化 key 前缀隔离 |
| 提交 | git add 显式文件清单(共用工作区铁律);`type(scope): 中文一句话祈使句`,scope 用 skill-hub / mcp-hub |
