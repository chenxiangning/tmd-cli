# cli-dsh 插件设计 —— 第十个 CLI 引擎(DeepSeek Harness)

- 日期:2026-09-06
- 状态:已落地(同日修订:连接面板从设置搬首页,补齐 codemoss 功能点;二期会话接入见 specs/2026-09-07-cli-dsh-pty-adapter-design.md,下文「不移植 host-RPC 会话引擎」的范围界定已被二期取代)

## 背景与目标

DSH(DeepSeek Harness)是 codemoss 里已对接的本地 host 型引擎:`dsh` CLI(npm 包 `@deepseek-ai/dsh`)是 profile 启动器,`dsh web` 起本地 host(Web UI 在浏览器侧),模型与 API Key 全在 DSH 侧配置。目标:把 dsh 接进 tmd-cli 首页引擎卡,与既有 9 个 CLI 完全同级,并移植 codemoss 已做好的安装引导与启动引导(Mac/win 兼容)。

修订(2026-09-06 二轮,用户裁决):连接引导不放设置页,整体内嵌到首页 dsh 引擎卡下方;补齐 codemoss 面板的三个功能点 —— 自定义 dsh 路径、自动启动主机开关、可折叠「连接设置」(折叠头带摘要)。

范围:**安装 + 启动/连接引导**。不移植 codemoss 的 host-RPC 会话引擎(那需要 Rust supervisor + 长驻 RPC,与 tmd-cli「Rust 零配方、终端即会话」的形态不同构)。

## 方案取舍

| 决策点 | 选定 | 被否决 | 理由 |
|---|---|---|---|
| 安装通道 | `scriptInstall` 承载加固命令 `npm i -g --maxsockets=1 --fetch-retries=5 --no-audit --no-fund @deepseek-ai/dsh@latest`(unix/win 同串,bash -c / powershell -Command 均可执行),`npmPackage` 仅查 registry 新版 | 走默认 npm 通道 | codemoss installer.rs 的加固参数与 420s 长超时是踩坑产物(npm extract race);script 通道优先级高于 npm,零内核改动照抄配方 |
| 面板位置 | 首页 dsh 引擎卡下方原位内嵌;新增 kernel `homePanels.ts` 注册表(profileId 键)+ `PluginContext.registerHomePanel` 通道,welcome 的 EngineSection 渲染 | 设置 section(首版做法,用户否决);或 CliProfile 加 `homePanel` 字段 | codemoss 同构(选中引擎即见面板);注册表不占 CliProfile(cli.ts 已顶在 300 行铁则),模式与 filePanel/marketPanel 一致,重复注册抛错同纪律 |
| 启动语义 | PTY 会话跑 `<dsh|自定义路径> web --host H --port P`(profile args `["web"]`,面板「启动服务」同款):会话即 host,日志在幕布、杀会话即停 | 移植 codemoss Rust supervisor(probe→adopt→spawn→wait_ready + win 三层启动链) | supervisor 是 Rust 侧 CLI 配方,违反 tmd-cli「新增 CLI 引擎 = 插件目录 + allPlugins 一行,Rust 零改动」红线;PTY 会话天然给出可见日志与停止手段 |
| host 状态探针 | `POST {origin}/api/host.describe` 线格式 RPC(codemoss host.rs 同款信封),走通用 `quota_fetch` HTTP 通道 | `proc_communicate` 跑 curl;或新增 Rust dsh 探针命令 | quota_fetch 是现成通用 HTTP 原语(GET/POST/body),内核零配方;curl 属进程派生换汤不换药 |
| 停止服务边界 | 只登记本面板 `sessionSpawn` 拉起的会话 id,「停止服务」仅作用于自拉起进程;外部 host 显示「(非本客户端拉起,请在原处停止)」 | 像codemoss那样按端口找 pid 全杀 | codemoss supervisor 自己也只 kill 自 spawn(adopt 永不 kill);跨进程杀端口语义太粗 |
| 自动启动 | `autoStart` 默认开:进首页且 host 未运行且 dsh 二进制可用(cli_probe 支持绝对路径)时自动拉起;每次应用运行至多一次(`consumeAutoStart` 一次性闸,StrictMode 双挂载安全);拨开关不立刻启停(codemoss 口径) | 移植 codemoss「对话需要时拉起」的 RPC 前置时机 | tmd-cli 里开会话本身就是启动 host,唯一等价的「需要」时点是首页挂载;守卫放 spawn 闸门而非挂载计数,规避 StrictMode 下第二次挂载 seq 抢占丢终态的竞态 |
| 自定义路径 | `customBin` 存连接配置(localStorage 同键),`dshCommand()` 拼启动命令,存在性用 `cli_probe`(支持绝对路径与 PATH 名) | codemoss 式子页面 + Windows 可执行变体归一 | tmd-cli spawn 走 portable-pty 既有解析,与其它 9 个 CLI 同机制;探针原语已覆盖绝对路径 |
| 会话历史/触发符 | 一律不声明:listSessions、resumeArgs、triggers、readSessionStatus 全缺省 | 扫 `~/.dsh/sessions/<slug>/session-<uuid>/session.jsonl.zstd` 做列表 | 会话体是 zstd 压缩流,现有 fs 文本原语读不了;「不猜接口」纪律,不为此开内核口子 |
| Node 版本门槛 | 不声明 `requires: node`(npm 通道存在即隐含 node),门槛文案(Node ≥ 22.19 或 ≥ 24,codemoss doctor.rs 口径)放面板提示行 | 声明 requires 做存在性闸门 | 存在性闸门不表达版本语义,重复且误导;npm 失败自有报错 |

## 验证

- 单测:`src/plugins/cli-dsh/index.test.ts`(渠道常量/profile 形状/加固安装通道/`registerHomePanel` 接线且不注册设置 section)、`dshHost.test.ts`(连接归一/持久化 round-trip/旧档补默认/customBin 命令拼接/host.describe 信封解析:ok、缺字段、非对象 value、ok:false、非 200)。
- 全量:`pnpm typecheck`、`pnpm test`(959 passed)、`check:arch-boundary`、`check:file-size`、`pnpm build`(exit 0)全绿。
- 浏览器桩目检(1421 dev server,`__TAURI_INTERNALS__` 假 invoke):
  - 首页:DeepSeek Harness 卡(第 9 位,官方文档/版本 pill/更新)下方内嵌连接面板;「已就绪 10 / 10 个引擎」;
  - 自动启动:首页挂载即未运行 → 自动拉起 → 主机已连接(供应商/模型/会话数),「停止服务」出现、启动按钮消失;
  - 折叠:「连接设置 127.0.0.1:3080 · 自动启动开/关」摘要头,展开 = 自定义路径 / Host 地址 / 自动启动主机三行;拨开关摘要即时翻转且持久化;
  - 设置页:左侧导航仅「基础设置 / SSH 远程」,无 DeepSeek Harness(已删)。
- Mac/Win:安装命令 script 通道两端同串(unix bash -c / win powershell -Command 均可执行);win 侧 spawn 兼容(node 直启/sharp 修复等)属 codemoss host-RPC 形态专属,本客户端 PTY 走 portable-pty 既有路径,与其它 9 个 CLI 同机制,不重复处理。

## 落地修订(2026-09-07)

- **会话删除 + 空壳可见**(一期未覆盖,实测「删不掉 / 数量对不上」):
  host 0.1.1-rc.2 无删除 RPC,删除唯一通路 = 会话盘目录
  (`dshRpc.deleteHostSession` 扫 slug 目录定位;host 活扫描磁盘,删除即时同步,
  无需重启);`fs_remove_path` 白名单放行 `~/.dsh`(Rust 侧一行 + 正例测试)。
  blank 空壳(host 适配器接入时预创建的零消息会话)不再过滤,以「空会话」
  呈现——dsh Web UI 计数含空壳,隐藏即数量对不上,可见才可清。
  契约沉淀:`architecture/02-code-architecture.md` §5.2。
