# SSH 插件设计:一等会话 + 右栏 SFTP 树 + 端口转发(参照参考实现 复刻)

日期:2026-09-04
状态:已定稿(用户五项裁决已复核,实施期技术细节按本 spec「方案取舍」执行,不再回问)

## 背景与目标

tmd-cli 是插件化多 CLI 宿主,会话 = CLI profile + PTY。用户要求参照 参考实现(调研见 `docs/research/ssh-module-reference.md`)复刻其 SSH 模块:russh 引擎、三种认证 + known_hosts 信任流、SFTP、本地端口转发、代理、主机管理与 `~/.ssh/config` 导入。

用户裁决:功能面全量;SSH 终端为一等会话(中央幕布 + 顶栏 tab + 会话列表);SFTP 为右栏树 + 中央编辑器 tab;凭据 settings.json 明文;认证矩阵全量。

目标:

1. 新增 `src/plugins/ssh/` 插件(feature 类,可插拔)与 `src-tauri/src/ssh/` Rust 引擎,SSH 会话复用幕布全链路(输出缓冲/翻页/搜索/tab 条)。
2. 幕布硬约束不变:SSH 通道字节 → `pty://out/{sessionId}` → xterm.js 原样透传;一切增强(状态/转发/SFTP)在幕布之外。
3. 内核契约最小增改,遵守 R1/R3/R4 与 500 行铁则。

非目标(与 参考实现 短板对齐,均不做):ssh-agent、jump host、连接压缩、`-R`/`-D` 转发、凭据加密存储、Go 网关中继、AI 工具化。

## 方案取舍

### A1. SSH 会话接入模型 —— 选定:kind 扩展 + 专用创建入口

`SessionMeta` 增加可选 `kind: "cli" | "ssh"`(缺省 cli,Rust serde default);内核 `host.createSshSession(hostId, workspaceId)` 走新命令 `ssh_session_create`,返回的会话由 Rust 引擎以完全相同的事件契约(`pty://out/{id}`、`pty://exit/{id}`)驱动,幕布零改动。`session_write/resize/kill` 在命令层按注册表成员路由(PTY 优先,SSH 兜底)。

理由:tmd-cli 会话模型以 PTY 事件流为心脏,SSH 引擎产出同构字节流即可全链路复用;不造「会话提供者」抽象(YAGNI,当前只有两类)。

否决:(a)注册伪 CliProfile(command=ssh 走系统二进制)——认证退化为幕布文本交互,known_hosts/SFTP/转发全部落空;(b)右栏/overlay 承载终端——幕布全链路不可复用,体验割裂(用户已否决)。

### A2. 引擎底座 —— 选定:russh 0.62.2 + russh-sftp 2.3(照搬竞品实测组合)

兼容本仓 `rust-version = "1.80"`(russh 0.63 MSRV 1.85 超限)。tokio 以 tauri runtime 为宿主(`tauri::async_runtime`),不新增直接依赖。认证、KBI 多轮、PEM 清洗、known_hosts 指纹、代理握手(HTTP CONNECT/SOCKS5)、`-L` 转发、SFTP 乐观并发与递归传输均按竞品逻辑移植,错误统一 `Result<_, String>` 对齐仓内惯例。

否决:(a)russh 0.63+ 并升 rust-version——动全仓工具链下限,超出本变更;(b)每连接独立 tokio runtime——tauri 已带,自建徒增复杂。

### A3. known_hosts 存储 —— 选定:独立 JSON(`~/.tmd-cli/ssh_known_hosts.json`)

竞品用 SQLite;本仓设置文件全是 JSON + `write_json_atomic` 原子写原语,单表键值(host:port → 算法/base64/SHA256 指纹)不值得进 SQLite。

否决:塞进 settings.json——known_hosts 是 Rust 侧高频读写的事实数据,不该过前端 schema 透传。

### A4. 断线重连 —— 选定:Rust 侧有界透明重连

同会话 id 内自动重连(3 次,2/5/10s 退避,keepalive 30s×3 探活触发),SFTP/转发随连接代际失效重建;超限发 `pty://exit/{id}`,会话按 tmd-cli 惯例消亡,不复活。竞品的「连接 id 代际」机制照搬(防旧通道写入新连接)。

否决:前端驱动重连/会话复活——tmd-cli 会话模型里退出即移除,复活语义侵入内核。

### A5. 认证与 prompt 流 —— 选定:竞品三段式照搬

密码/私钥(含 passphrase、PEM 清洗、`~` 与 Windows 变量展开)/KBI 多轮(上限 5 轮,可回落密码)。host key 未知 → 事件 `ssh://prompt/{id}`(指纹 + promptId)→ 前端 overlay 应答(信任/拒绝/120s 超时)→ 命令 `ssh_prompt_answer`。KBI 同通道(promptId 分型)。凭据随连接命令传入,不落 Rust 侧状态。

### A6. SFTP —— 选定:同连接 subsystem + 右栏树 + 编辑器 tab

会话连接上开 sftp subsystem(不重认证);右栏 SSH 面板内远端文件树(懒展开,对齐 files 插件交互);点击文件开编辑器 tab(`ssh://{sessionId}/{path}`,kind="ssh-file"),CodeMirror 读写走 SFTP,写回带 `expectedMtime/expectedSize` 乐观并发检测(竞品模式),脏标记/⌘S 对齐本地编辑习惯。

否决:接入 files 插件树做本地/远程切换——侵入 files 插件与 filePanel 契约,改动面最大(用户已选右栏树)。

### A7. 端口转发 —— 选定:右栏面板分区,竞品语义照搬

`-L`:会话级注册表,127.0.0.1 绑定,localPort 留空自动分配(49152+ 探测),占用预检命令 `ssh_forward_check_port`,启停/列表事件驱动(`ssh://event/{id}` 携带转发快照),会话关闭级联停止。

### A8. 主机配置 —— 选定:kernel settings schema 增 ssh 域

`settings.ssh.hosts: SshHostConfig[]`(id/name/host/port/username/authType/password/privateKey/passphrase/proxy),schema 归 `kernel/settings.ts`(sanitize + 默认值),Rust 侧不读设置文件——连接命令由前端携带完整主机配置(对齐「settings Rust 仅透传」现状)。明文存储与竞品同级,风险记录于此。

### A9. 入口与集成 —— 选定:三入口 + kind 门控

- 新建入口:内核新挂载点 `workspace.newSessionMenu`(SessionMenu「新建会话」组末尾渲染 `<Mounts/>`),ssh 插件贡献「SSH 连接」项 → 主机选择 overlay → `host.createSshSession`。会话挂当前工作区(cwd 记工作区根,仅作归属)。
- 会话列表:workspace SessionList 为 `kind==="ssh"` 会话增 SSH 分组(lucide 语义图标,只依赖 kernel 类型,不 import ssh 插件)。
- composer:AppShell 对激活 ssh 会话隐藏 composer 面板(纯幕布输入);Ask 检测按 kind 跳过(远端输出会误报 `Do you want` 类标记);审批线/状态栏天然不参与(无 CLI profile);呼吸灯照常(远端输出即活动)。

## 组件与数据流

```
[新建入口] SessionMenu(workspace.newSessionMenu Mounts) → HostPicker(overlay)
    → host.createSshSession(hostId, workspaceId)
        → ipc.sshSessionCreate(hostConfig) ── Rust ssh/ 引擎:
            transport(TCP+代理) → auth(密码/私钥/KBI) → [host key 信任 prompt]
            → channel PTY shell → io 泵 → pty://out/{id} + session_log(翻页)
            keepalive ping → 重连(代际++) → SFTP subsystem / -L 转发
        ← SpawnedSession → host.adoptSpawned(幕布/tab/列表全链路)
[右栏] SshPanel(filePanel 注册):连接卡(状态/延迟/断开) + ForwardSection + SftpTree
[编辑器] tab(ssh://{sessionId}/{path}) → RemoteFileTab(CodeMirror + SFTP IO)
[设置] SshSettingsSection:主机 CRUD + ~/.ssh/config 扫描导入 + known_hosts 重置
[事件] ssh://event/{id}(状态/转发快照/SFTP 进度) ssh://prompt/{id}(hostkey/KBI)
```

文件清单(全部 ≤500 行):

- Rust `src-tauri/src/ssh/`:`mod.rs`(注册表/状态机)、`transport.rs`(TCP+代理握手)、`auth.rs`(认证+KBI)、`session.rs`(生命周期+IO 泵+重连)、`sftp.rs`(SFTP 注册表+操作)、`forward.rs`(-L)、`known_hosts.rs`(JSON 存储)、`commands.rs`(Tauri 命令)、内嵌 tests。
- kernel:`ipc.ts`(SSH 契约类型+命令+事件订阅)、`settings.ts`(ssh 域)、`host.ts`(createSshSession+askWatch kind 门)、`plugin.ts`(新挂载点)、`session.rs`(kind 字段)。
- 插件 `src/plugins/ssh/`:`index.tsx`、`types.ts`、`state.ts`(事件订阅状态仓)、`scan.ts`(~/.ssh/config 解析+路径展开)、`picker/HostPicker.tsx`、`panel/{SshPanel,SessionCard,ForwardSection,SftpTree}.tsx`、`settings/{SshSettingsSection,HostModal,ImportModal}.tsx`、`editor/{RemoteFileTab,remoteFileIo}.tsx`。
- 外壳:`workspace/SessionList.tsx`(SSH 分组)、`workspace/SessionMenu.tsx`(挂载点渲染)、`AppShell.tsx`(composer 门控)。

## 错误处理

- 引擎错误统一 `Result<_, String>`(仓内惯例),连接/认证失败经 `ssh://event/{id}` 状态事件呈现于会话卡与幕布外状态条,不写入幕布字节流(幕布硬约束)。
- prompt 超时(120s)= 拒绝,连接终止;KBI 轮次超 5 = 认证失败。
- SFTP 写冲突(mtime/size 不符)返回显式错误码前缀 `E_CONFLICT`(对齐 git 的 `E_*` 前缀惯例),编辑器 tab 弹覆盖确认。
- 代理配错快速失败,不静默直连(竞品纪律)。

## 验证

1. Rust:`cargo test`(模块单测:代理解析/SOCKS5 地址编码/转发校验/known_hosts 指纹/路径安全/PEM 清洗)+ `cargo clippy --all-targets -- -D warnings` + `cargo fmt --check`。
2. 前端:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`(scan.ts 路径展开、settings sanitize、状态仓、转发校验的 Vitest)。
3. 目检:`pnpm tauri:dev` 真实窗口——主机管理/导入、新建入口、幕布 SSH 会话、右栏面板、编辑器 tab、composer 隐藏。
4. 端到端:本机 localhost sshd(或可达主机)真实连接,验证密码/私钥认证、known_hosts 信任流、SFTP 读写、端口转发(curl 本地转发口)。
