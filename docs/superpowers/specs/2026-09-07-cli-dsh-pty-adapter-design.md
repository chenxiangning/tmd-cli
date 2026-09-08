# cli-dsh 会话接入:PTY 适配器方案(host-RPC 第二客户端)

- 日期:2026-09-07
- 状态:已落地(本 spec 记录一期方案;实现经多轮修订收敛,以文末「落地修订」为准)

## 背景与目标

dsh(DeepSeek Harness)只有 web profile,没有 TUI:对话 UI 全在 host 的 Web 页面里,
`dsh web` 的 PTY 幕布只有两行启动日志,composer 写 stdin 无消费者 —— 「创建 dsh 会话
无法对话」是形态问题而非启动 bug。

第一轮尝试(iframe 内嵌 host Web UI,commit d1c0440,已 revert)被否决:把 dsh 官方 UI
整套搬进中央区,项目管理/会话列表/设置与 tmd-cli 自家体系完全重复,体验割裂。

目标:DSH 会话在 tmd-cli 里表现为**普通 CLI 会话** —— 侧栏工作区管理、自家 composer
发消息、自家幕布看对话、审批/提问走 askWatch 卡片检测。对接口径移植 codemoss
(src-tauri/src/engine/dsh,daemon 侧 host-RPC 引擎桥),但不搬 Rust daemon:
tmd-cli 的桥接点放在 PTY 子进程(适配器脚本),内核零协议知识。

## 方案取舍

**选定:PTY 适配器(Node CJS 脚本,spawn 为伪 CLI)**

- 数据流:composer 文本 → PTY stdin → 适配器 → `session.prompt` RPC;
  host mux WebSocket(/api/events.mux)→ 帧投影(dsh-project.cjs,线格式照抄
  codemoss events.rs)→ ANSI 文本 → PTY stdout → xterm.js 原样透传(幕布铁律不破)。
- 审批/提问:mux `approval/requested` / `question/requested` 帧 → 幕布输出
  `[DSH 审批]` / `[DSH 提问]` 标记行 → 插件声明 askMarks → 内核 askWatch 自动
  检测(等待确认标签 + 提示音),与 omp 卡片同机制;应答经 stdin `y`/`n` 或
  `题号:选项号` → `POST /api/respond`(信封照抄 codemoss host.rs)。
- host 生命周期:适配器探针 host.describe 不通时自拉起 `dsh web --no-open` 并轮询
  就绪;已在即 adopt(第二个实例 EADDRINUSE 秒退无碍)。首页面板仍可显式启停。
- 分发:适配器源码经 vite `?raw` 内联进 bundle,spawnTransform 前幂等落盘到
  `<configHome>/adapters/dsh/`(内容戳 .stamp 变化才重写),spawn 用落盘绝对路径。
- 内核改动面:`CliProfile.spawnTransform`(create/resume 双路,spawn 前插件改写
  SpawnSpec)与 `thinkingCommand`(工具栏思考位可点声明)两个通用字段 +
  sessionSpawn 两行调用;CliPrerequisite 类型提走拆件(300 行铁则)。
  内核不理解 DSH 任何协议(R 系铁律)。

**被否决:**

- iframe 内嵌官方 Web UI(第一轮实现):两套项目管理/会话/设置并行,割裂;用户否决。
- Rust daemon 引擎桥(照搬 codemoss 全量):约 6000 行 Rust + 前端事件投影,
  违反 tmd-cli「Rust 零配方、插件化」红线,工作量与收益不成比例。
- 前端直连 host(渲染层做 RPC 客户端):幕布/composer/会话表全要开特例分支,
  破坏「会话 = PTY」的统一模型,侧栏/未读/锚点等通用能力全部失效。

## 验证

- 单测:dsh-project.test.ts 锁 mux 帧投影线格式(server-request 信封解包、
  chunk/turn-end/approval/question 形状);index.test.ts 锁 spawnTransform +
  askMarks 声明;全量 975 测试绿。
- 真 host 端到端(127.0.0.1:3080 活 host):建 workspace/session、连 mux、
  文本轮次「收到 → ✓ 轮次完成」;`/permission workspace-write` 经 commands/execute
  转发;越权写触发 `[DSH 审批]` 卡 → stdin `y` 应答 → 工具执行 → 轮次完成。
- 浏览器桩目检:新建会话菜单点 dsh → spawn 日志 = `node <configHome>/adapters/dsh/
  dsh-adapter.cjs --host --port --workspace-id --workspace-path`,落盘 5 文件 + 2 目录。
- 铁律:typecheck / test / check:arch-boundary / check:file-size 全绿
  (适配器四件均 ≤300 行;.cjs 后缀规避仓库 `type: module`)。

## 落地修订(2026-09-07 一期收口,以实现为准)

1. **适配器拆件 18 个 .cjs**(300 行铁则):rpc/project/print/theme/render/commands/
   menu/menuhost/keys/click/zone/pending/spinner/stream/turn/think/footer + 入口
   dsh-adapter;`?raw` 内联清单见 adapterDeploy.ts(STAMP 变化自动重写并清残留旧件)。
2. **底栏行单一所有权(dsh-stream)**:scroll region 收缩 1..n-1,第 n 行钉死给
   spinner/idle footer,内容写入永不触底栏 → 流式全程 loading 不断;footer =
   `● 模型 › cwd › ⑂ 分支 脏数 › ctx 条`(仿 pi/omp,诚实省 $ 成本段)。
3. **交互区(dsh-zone + dsh-click)**:菜单/审批卡/提问卡共用一个区,ESC[6n CPR
   定位 + SGR 鼠标上报 → 行级点击;↑↓/滚轮/Enter/Esc 键盘全通路;提问应答线格式
   = `answers:[{id,selected:[文本]|custom}]` 数组(实证对象 map 会被 zod 拒收)。
4. **DSH 事件流实证**:一个用户轮次 = turn/start → [reasoning/tool/text]×N(多
   step)→ turn/end 仅一次;spinner 整轮常驻不按 chunk 起停;上下文计量唯一真源 =
   session.list projections(usage 帧只有本轮量);MiniMax 把 </mm:think> 吐进
   text-delta → dsh-think 流式剥离。
5. **host 会话 = 后台基础设施**:内核 `spawnRawSession` 加通用 `opts.activate`
   (缺省 true),面板拉起传 false → 自动启动不抢首页中央区。
