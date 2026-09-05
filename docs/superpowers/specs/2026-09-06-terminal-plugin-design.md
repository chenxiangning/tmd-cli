# 内置终端:terminal 插件(SSH 一等会话同构)+ 头部左区入口

日期:2026-09-06
状态:已批准(用户确认:点击 = 聚焦最新/无则新建,Option 点击强制新建;shell 按平台默认,不进设置页)

## 背景与目标

tmd-cli 的幕布终端目前只为 CLI/SSH 会话服务:开一个纯 shell(zsh)要绕道 CLI 引擎,没有"内置终端"形态。目标:

1. 新增**内置终端**:本地默认 shell 的一等 PTY 会话,复用幕布全链路(字节透传/翻页/搜索/tab 条);
2. **插件化对接**:新插件 `terminal`,经 `activate(ctx)` 注册面贡献 UI,内核只补会话装配与挂点两个通用原语;
3. **入口**:头部左区图标簇(折叠左栏/插件市场/回到首页旁)加第 4 个 icon 按钮。

## 方案取舍

**选定:kind="shell" 的一等会话,仿 SSH 同构模式。** kernel 新拆件 `shellSessions.ts`(`ShellSessionService`,与 `SshSessionService` 同构:spawn + adopt 常驻订阅输出/退出),复用 `session_spawn` 的任意 command 能力(Rust 仅给 `SpawnSpec` 加可选 `kind`/`title` 两个字段,serde default,CLI 路径字节不变)。理由:PTY 链路(幕布/缓冲/活动守望/会话 tab)对会话后端零感知的既有契约直接复用;composer 隐藏、AskWatch 跳过等"非 CLI 会话"闸位 ssh 已趟出先例,shell 顺同一条缝;无 profile 身份,`getCliProfile` 全部消费点 `?.` 兜底,天然 inert。

**否决:伪 CLI profile(profileId="shell" 走 SessionSpawnService)。** `create` 强制要求注册 profile 且会触发身份探测快照/status 种子/秒退守望——zsh 敲 `exit` 会被误报"启动失败",还要为 shell 注册假 profile 污染引擎名册与建议链路。语义污染大于代码复用收益。

**否决:独立底部终端面板(VS Code 式 dock)。** 需要新做一套 dock 布局、面板内多 tab 条与聚焦管理;图 1 参考形态就是"会话 tab 之一",走一等会话零新 UI 骨架。

**否决:shell 路径进设置页。** 一期按平台默认(macOS `zsh -l` / Linux `bash -l` / Windows `cmd.exe`),用户确认后续有需求再加分区,避免提前铺设置 UI 与持久化字段。

## 设计

### 会话装配(kernel)

- `kernel/shellSessions.ts`(新,仿 `sshSessions.ts`):`ShellSessionService.create(workspaceId?)`
  - cwd = 指定/活跃工作区 root(SshSessionService 同款解析);无工作区 → 发 `sessionStartFailed`(复用 `StartFailureToast`)不 spawn;
  - spec:`{ command, args, cwd, title, kind: "shell" }`;`ipc.sessionSpawn("shell", spec, workspaceId)`;
  - adopt:refreshSessions → 常驻订阅 `pty://out` / `pty://exit`(exit → `removeSession` + `sessionExited` 广播)→ 双订阅 await 缝隙复查存活成对退订 → 广播 `sessionsChanged` / `activeSessionChanged`。
- `host.createShellSession(workspaceId?)`:公开入口(host.ts 组装依赖面,仿 `createSshSession`;host.ts 不破 500 行铁则)。
- CLI 专属链路(身份探测/秒退守望/statusWatch/statusSeed)一律不接:shell 无磁盘会话、无 profile。

### 契约扩展

- Rust `SpawnSpec` + `#[serde(default)] kind: Option<String>` / `title: Option<String>`;`session_spawn` 注册 `SessionMeta` 时 `kind: spec.kind.unwrap_or("cli")`、`title: spec.title`。
- TS `SpawnSpec` 同步两可选字段;`SessionMeta.kind` 扩为 `"cli" | "ssh" | "shell"`。
- kernel `plugin.ts` MountPoint 加 `header.leftCluster`(头部左区按钮簇,Inbox 之后);`TopBar` 渲染 `<Mounts point="header.leftCluster" />`。

### 非 CLI 会话闸位收敛

- `MainPanel` composer 隐藏闸:`activeKind === "ssh"` → `ssh || shell`(幕布即输入面)。
- `AskWatch` 两处守卫(onOutput / onScreenSample)从"跳过 ssh"收紧为"非 cli 一律跳过":ask 标记词是 CLI 面板专用,shell 与未来 kind 默认不参与检测。
- 侧栏:workspace 插件加 `ShellSessionGroup`(仿 `SshSessionGroup`:列本工作区 `kind === "shell"` 活会话,点击聚焦,右键确认后结束会话)。kind 是内核级会话概念,遵循 ssh 分组落在 workspace 插件的先例。

### terminal 插件(`src/plugins/terminal/`)

- meta:name "内置终端",icon `SquareTerminal`,category "feature",id `terminal`;`allPlugins` 注册一行。
- `activate`:`ctx.contribute("header.leftCluster", TerminalButton)`。
- `TerminalButton`:与既有三钮同款 `.titlebar-action` 14px;点击 = 聚焦最新 shell 会话(`createdAt` 最大),无则 `host.createShellSession()`;`Option+点击` = 强制新建;活跃会话是 shell 时亮 `is-active`;模块级在途 Promise 单例闸防双击双开;spawn 被拒 emit `sessionStartFailed` 呈现原因。

### 会话呈现

- 顶栏 tab 条自动生效(`kernel/sessionTabs` 订阅 `activeSessionChanged`),标题取 `meta.title`(`"zsh"`/`"bash"`/`"cmd"`,Rust `title` 字段透传)。
- 幕布零分叉:`TerminalView` 按 sessionId 渲染,不动一行。

## 验证

- 前端:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`;
- Rust(在 `src-tauri/`):`cargo test && cargo clippy --all-targets -- -D warnings && cargo fmt --check`;
- kernel 契约测试:spawn spec 形状(profileId="shell"/kind/title/cwd)、exit 清场(removeSession + sessionExited 广播)、输出接线、双订阅缝隙退订、无工作区拒 spawn;
- `pnpm tauri:dev` 目检:点钮开 zsh、跑命令回显、`exit` 收 tab 回退、Option 多开、tab 条标题、侧栏终端组、composer 不出现、CLI 会话往返无回归。
