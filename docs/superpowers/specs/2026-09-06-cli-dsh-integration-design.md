# cli-dsh 插件设计 —— 第十个 CLI 引擎(DeepSeek Harness)

- 日期:2026-09-06
- 状态:已落地

## 背景与目标

DSH(DeepSeek Harness)是 codemoss 里已对接的本地 host 型引擎:`dsh` CLI(npm 包 `@deepseek-ai/dsh`)是 profile 启动器,`dsh web` 起本地 host(Web UI 在浏览器侧),模型与 API Key 全在 DSH 侧配置。目标:把 dsh 接进 tmd-cli 首页引擎卡,与既有 9 个 CLI 完全同级,并移植 codemoss 已做好的安装引导与启动引导(Mac/win 兼容)。

范围:**安装 + 启动/连接引导**。不移植 codemoss 的 host-RPC 会话引擎(那需要 Rust supervisor + 长驻 RPC,与 tmd-cli「Rust 零配方、终端即会话」的形态不同构)。

## 方案取舍

| 决策点 | 选定 | 被否决 | 理由 |
|---|---|---|---|
| 安装通道 | `scriptInstall` 承载加固命令 `npm i -g --maxsockets=1 --fetch-retries=5 --no-audit --no-fund @deepseek-ai/dsh@latest`(unix/win 同串,bash -c / powershell -Command 均可执行),`npmPackage` 仅查 registry 新版 | 走默认 npm 通道 | codemoss installer.rs 的加固参数与 420s 长超时是踩坑产物(npm extract race);script 通道优先级高于 npm,零内核改动照抄配方 |
| 启动语义 | PTY 会话跑 `dsh web --host H --port P`(profile args `["web"]`,面板「启动服务」同款):会话即 host,日志在幕布、杀会话即停 | 移植 codemoss Rust supervisor(probe→adopt→spawn→wait_ready + win 三层启动链) | supervisor 是 Rust 侧 CLI 配方,违反 tmd-cli「新增 CLI 引擎 = 插件目录 + allPlugins 一行,Rust 零改动」红线;PTY 会话天然给出可见日志与停止手段 |
| host 状态探针 | `POST {origin}/api/host.describe` 线格式 RPC(codemoss host.rs 同款信封),走通用 `quota_fetch` HTTP 通道 | `proc_communicate` 跑 curl;或新增 Rust dsh 探针命令 | quota_fetch 是现成通用 HTTP 原语(GET/POST/body),内核零配方;curl 属进程派生换汤不换药 |
| 停止服务边界 | 只登记本面板 `sessionSpawn` 拉起的会话 id,「停止服务」仅作用于自拉起进程;外部 host 显示「(非本客户端拉起,请在原处停止)」 | 像codemoss那样按端口找 pid 全杀 | codemoss supervisor 自己也只 kill 自 spawn(adopt 永不 kill);跨进程杀端口语义太粗 |
| 会话历史/触发符 | 一律不声明:listSessions、resumeArgs、triggers、readSessionStatus 全缺省 | 扫 `~/.dsh/sessions/<slug>/session-<uuid>/session.jsonl.zstd` 做列表 | 会话体是 zstd 压缩流,现有 fs 文本原语读不了;「不猜接口」纪律,不为此开内核口子 |
| Node 版本门槛 | 不声明 `requires: node`(npm 通道存在即隐含 node),门槛文案(Node ≥ 22.19 或 ≥ 24,codemoss doctor.rs 口径)放设置面板提示行 | 声明 requires 做存在性闸门 | 存在性闸门不表达版本语义,重复且误导;npm 失败自有报错 |

## 验证

- 单测:`src/plugins/cli-dsh/index.test.ts`(渠道常量/profile 形状/安装通道/设置 section 接线)、`dshHost.test.ts`(连接归一/持久化 round-trip/坏 JSON/host.describe 信封解析:ok、缺字段、非对象 value、ok:false、非 200)。
- 全量:`pnpm typecheck`、`pnpm test`(956 passed)、`check:arch-boundary`、`check:file-size`、`pnpm build`(exit 0)全绿。
- 浏览器桩目检(1421 dev server,`__TAURI_INTERNALS__` 假 invoke):
  - 首页引擎卡:DeepSeek Harness 与其余 9 引擎同级同构(官方文档链接、版本 pill、更新按钮),「已就绪 10 / 10 个引擎」;
  - 设置面板:状态机 未运行 → 启动服务 → 正在启动… → 主机已连接(供应商/模型/会话数)+「停止服务」出现、启动按钮消失;外部拉起态显示 adopt 提示、启动按钮禁用。
- Mac/Win:安装命令 script 通道两端同串(unix bash -c / win powershell -Command 均可执行);win 侧 spawn 兼容(node 直启/sharp 修复等)属 codemoss host-RPC 形态专属,本客户端 PTY 走 portable-pty 既有路径,与其它 9 个 CLI 同机制,不重复处理。
