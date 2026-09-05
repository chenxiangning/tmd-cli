# opencode CLI 插件化接入设计

- 日期:2026-09-05
- 状态:已确认(用户拍板全量接入;方案 A + 仅 npm 安装通道 + welcome 凭据一并接)
- 范围:新增第 9 个 CLI 引擎 opencode,标准插件路径,与现有 8 引擎同构的接入效果

## 背景与目标

opencode(anomalyco/opencode,本机 1.18.25)是开源 AI coding agent TUI。目标:按插件化标准路径接入 —— 新建 `src/plugins/cli-opencode/` 实现 `Plugin` 接口 + `src/plugins/index.ts` 的 `allPlugins` 数组注册一行,内核与 Rust 零改动,获得与其余引擎一致的能力面:

- 引擎卡(welcome 安装/文档入口 + 凭据盘点)、新建会话、PTY 幕布
- composer 触发符(`/` 命令、`@` 文件)与命令抽屉、MCP 分区
- 会话列表/恢复(`--session <id>`)、内容级身份绑定、模型状态、对话锚点栏
- checkpoints events 归因(readSessionEdits)

### 本机实证(2026-09-05,opencode 1.18.25)

| 事实 | 证据 |
|---|---|
| 活跃存储为 SQLite `~/.local/share/opencode/opencode.db`(WAL);`storage/` JSON 布局 2026-02 起停写 | stat mtime 对比 + data_migration 空 |
| `session` 表:`id/title/directory(spawn cwd)/time_created/time_updated/model(JSON: id/providerID/variant)` | sqlite3 实查 |
| `message` 表 data JSON:`role/time.created/model{providerID,modelID}`;用户消息正文在 `part` 表 `{"type":"text","text"}` | 实查 |
| `part` 表 tool 部件:`{"type":"tool","tool":"write"/"edit","state":{"status":"completed","input":{"filePath"},"time":{"end"}}}` | 实查 |
| TUI 恢复:`opencode -s/--session <id>`(另有 `-c/--continue`) | `opencode --help` |
| 触发符:`/` 命令(内置 17 条;`!` bash 不属于 composer kind 不声明)、`@` 文件引用 | 官方 TUI 文档 |
| 自定义命令:全局 `~/.config/opencode/commands/` + 项目 `.opencode/commands/`,文件名即命令名;子目录命名空间未文档化(不猜,只扫根级 .md) | 官方 commands 文档 |
| 配置:`~/.config/opencode/opencode.json`(`mcp` 表、`command` JSON 命令、`model` 默认模型) | 本机文件实读 |
| auth.json:顶层 `{供应商id: {type: "api"/"oauth", key?…}}` | 本机 jq 实查(未输出密钥) |
| 安装:npm `opencode-ai` 三端官方支持;unix 脚本已验证但 Windows 脚本未见于官方文档 → 仅声明 npm 通道 | 官方 install 文档 |

## 方案取舍

### 选定:方案 A —— 独立插件 + SQLite 直读

- `src/plugins/cli-opencode/` 内聚全部 opencode 磁盘知识,经内核既有只读原语 `ipc.sqliteQuery`(omp 读 agent.db 同款先例;WAL 支持并发读,opencode 运行中读取不阻塞)查 `opencode.db`。
- 家目录经 `ipc.configHomeDir()`(Rust `dirs::home_dir()`,omp 同款用法),**Rust 零改动**;数据目录解析 `$XDG_DATA_HOME ?? ~/.local/share` + `/opencode`(macOS 实证;Windows 同公式,待实机校验,读不到只是列表为空,不误伤)。
- 单库多会话(首个此类 CLI,不同于 omp/pi 的每会话一 JSONL):`CliDiskSession.path` 采用合成路径 `<dbPath>#<sessionId>`(契约注释「目录类插件自行拼内部路径」同精神),`readSessionFileIdentity` 拆 `#` 后按 id 查库自证 `{id, cwd: directory, createdAt: time_created}`;mtime 水位兜底在共享单库文件下必然张冠李戴,故必须声明内容级身份。

理由:与 8 引擎完全同构、零新架构概念、全部字段本机实证。代价:库表格式随 opencode 演进需跟随(列缺失时按「字段缺失=未识别」降级,与契约一致)。

### 否决:方案 B —— JSON storage 兼容层

为 2026-02 起停写的废弃格式写适配是死代码;opencode 自身已迁 SQLite。

### 否决:方案 C —— opencode serve HTTP API

headless server 需进程/端口生命周期管理,与 PTY 幕布架构冲突;磁盘直读贴合 omp 先例且不引入网络面。

## 设计

### 文件分工(全 ≤500 行)

```
src/plugins/cli-opencode/
  index.tsx     插件装配(Plugin + CliProfile 声明 + 品牌 glyph,官方 favicon vendored)
  db.ts         opencode.db 知识(sqliteQuery 封装 + 行解析纯函数,可测)
  config.ts     opencode.json 知识(默认模型 / MCP 表 / JSON 自定义命令;全局+项目合并)
  commands.ts   内置斜杠命令静态表 + commands/*.md 根级扫描
  db.test.ts / config.test.ts / commands.test.ts
```

### CliProfile 声明

- `id: "opencode"` / `command: "opencode"` / `npmPackage: "opencode-ai"` / `docsUrl: "https://opencode.ai/docs"`
- `triggers`: `/` command、`@` file(`!` bash 非 composer kind,不声明)
- `resumeArgs: (id) => ["--session", id]`
- `listSessions`: `SELECT id,title,directory,time_created,time_updated FROM session WHERE directory = ?1 ORDER BY time_updated DESC` → CliDiskSession(path = `<db>#<id>`)
- `readSessionFileIdentity`: 拆合成路径 → `SELECT directory,time_created FROM session WHERE id=?1`
- `readSessionStatus`: 最新 message 的 `model{providerID,modelID}` 拼 `provider/model`;variant 存在且 ≠ "default" → thinkingLevel
- `readSessionUserMessages`: message(role=user) ⋈ part(type=text) 按 time_created 序,id = message.id;full=false 取尾部 40 条窗口再正序返回
- `readSessionEdits`: part(type=tool, tool∈{write,edit}, status=completed) 且 time_created > sinceTs → `{path: input.filePath, ts: state.time.end ?? 行 time_created}`(增量水位契约)
- `readDefaultStatus`: 合并配置 `model` 字段 → `{model}`
- `listSuggestions`: 内置静态表 + md 扫描 + JSON 命令,同名自定义覆盖内置(官方语义)
- `listMcpServers`: 合并配置 `mcp` 表 → insert 项(token `@name` 语法仅 `@alias` 引用语义已实证;MCP 服务器项展示名 + enabled 态,点击插入名字供会话引用)
- 不声明:`editMarks`(events 归因已覆盖,PTY 字面量未实证)、`askMarks`(面板字面量未实证,先靠内核通用标记)、`bracketedPaste`(非 pi-tui 系)、`fetchQuota`(多供应商无统一额度接口;凭据盘点只到「已登录」层)

内置命令 action 初判(bare 合法 → send;实测校准回填契约测试):send = connect/compact/details/export/help/init/models/new/sessions/share/themes/thinking;insert = editor(依赖 $EDITOR 环境)/exit(误触即关会话)/undo/redo(直接作用于上一条消息,误触代价高)。

### welcome 凭据盘点

- `src/plugins/cli-shared/opencodeDisk.ts`(实现时由 opencodeAuth 更名,并入磁盘布局知识):数据/配置目录解析 + 读 auth.json 列供应商 id(文件头声明准入:cli-opencode + welcome 联合消费);不持久化密钥内容,仅透传给既有 vendor 检测
- `welcome/credentials.ts` 统一入口加 `case "opencode"`:按 pi 模式 `detectVendorByProviderId` → 已知 vendor 走额度查询,未知显示「已登录」;「opencode」官方 Zen id 按未知处理(不猜接口)

### 注册

`src/plugins/index.ts`:import + `allPlugins` 加一行。`composer/cliProfiles.contract.test.ts` 的 BARE_LEGAL/CANDIDATE_SETS 补 opencode 条目。其余 UI(引擎卡/会话列表/抽屉)全部从注册表自动派生,零改动。

## 验证

1. 单测:db 行解析(session/message/part/工具部件)、config 合并解析(mcp/command/model)、commands 静态表契约 + md 扫描、auth.json 解析 —— 全部纯函数,不连真库
2. 门禁:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`
3. 冒烟(本机真数据):临时脚本走 sqliteQuery 等价 SQL 对真库跑通五类查询(listSessions/identity/status/userMessages/edits),与 sqlite3 CLI 结果一致
4. UI 目检清单(移交用户,`pnpm tauri:dev`):欢迎页出现 opencode 引擎卡(已装态)+ 凭据盘点行;新建 opencode 会话幕布起 TUI;`/` `@` 触发补全;命令抽屉分区;会话列表出历史会话;点历史会话恢复;锚点栏出用户消息;工具栏模型名;checkpoints 审批线出现 events 归因批次;Ask 等待标记(如无则记录字面量待补 askMarks)
