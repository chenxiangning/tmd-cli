## Why

tmd-cli 的会话模型只覆盖本地 CLI(PTY 子进程)。用户需要在客户端内直连远程主机:交互终端、改配置文件、看日志、开隧道。参照竞品 参考实现的 SSH 模块(调研见 `docs/research/ssh-module-liveagent.md`,设计 spec 见 `docs/superpowers/specs/2026-09-04-ssh-plugin-design.md`),以其 russh 引擎与交互逻辑为蓝本复刻,做成 tmd-cli 的可插拔 feature 插件。

## What Changes

- **Rust 引擎** `src-tauri/src/ssh/`:russh 0.62.2 + russh-sftp 2.3;transport(TCP + HTTP CONNECT/SOCKS5 代理)、auth(password/privateKey/KBI 多轮)、known_hosts(`~/.tmd-cli/ssh_known_hosts.json`,SHA256 指纹 + 信任 prompt)、会话生命周期(keepalive 30s×3、有界透明重连 3 次退避、连接代际)、SFTP(同连接 subsystem:list/读写/递归传输,mtime+size 乐观并发)、本地端口转发 `-L`(自动端口分配、占用预检、会话级联)。
- **一等会话**:`SessionMeta.kind: "cli" | "ssh"`;`host.createSshSession` 经 `ssh_session_create` 建会话,Rust 引擎以 `pty://out/{id}` / `pty://exit/{id}` 同构事件驱动幕布(输出缓冲/翻页/搜索/tab 条零改动);`session_write/resize/kill` 按注册表路由。
- **右栏 SSH 面板**(filePanel 注册):连接卡(状态/延迟/断开/重连) + 端口转发分区 + SFTP 远端文件树(懒展开)。
- **远程文件编辑**:编辑器 tab `ssh://{sessionId}/{path}`,CodeMirror 经 SFTP 读写,写回乐观并发检测,脏标记 + ⌘S。
- **主机管理**:设置页 SSH 分区(主机 CRUD、`~/.ssh/config` 扫描导入、known_hosts 重置);配置存 `settings.ssh.hosts`(kernel schema,明文,spec 记录风险)。
- **入口与门控**:新挂载点 `workspace.newSessionMenu`(SessionMenu 渲染 Mounts,ssh 插件贡献「SSH 连接」项 → 主机选择 overlay);workspace SessionList 增 SSH 分组(只依赖 kernel 类型);AppShell 对 ssh 会话隐藏 composer;Ask 检测按 kind 跳过。
- **不做**(对齐竞品短板 + 用户裁决):ssh-agent、jump host、压缩、`-R`/`-D`、凭据加密、网关中继、AI 工具化。

## Capabilities

### New Capabilities

- `ssh-plugin`: SSH 一等会话(幕布渲染)、russh 引擎(认证矩阵/known_hosts/重连/代理)、右栏面板(连接/转发/SFTP 树)、远程文件编辑 tab、主机管理与导入。

### Modified Capabilities

- `workspace-sessions`(命名取意): 会话列表为 kind==="ssh" 会话渲染 SSH 分组;新建会话菜单渲染 `workspace.newSessionMenu` 挂载点。
- `composer`: 激活 ssh 会话时 composer 面板隐藏(纯幕布输入)。

## Impact

- **新增**:`src-tauri/src/ssh/`(mod/transport/auth/session/sftp/forward/known_hosts/commands + tests)、`src/plugins/ssh/`(index/types/state/scan/picker/panel/settings/editor)、`src/styles/ssh.css`
- **修改**:`src-tauri/Cargo.toml`(russh/russh-sftp/base64 复用)、`src-tauri/src/lib.rs`(mod + 命令注册 + 路由)、`src-tauri/src/session.rs`(kind)、`src-tauri/src/pty.rs`(uuid_v4/decode_utf8_chunk 提 pub(crate))、`src/kernel/{ipc,settings,host,plugin}.ts`、`src/plugins/index.ts`、`src/plugins/workspace/{SessionList,SessionMenu}.tsx`、`src/app-shell/AppShell.tsx`
- **架构边界**:不破坏 —— ssh 插件只依赖 kernel;workspace 只依赖 kernel 类型(kind/挂载点);R3 维持(@tauri-apps 只在 ipc.ts);Rust ssh 模块不 import 前端
- **门禁**:cargo test/clippy/fmt + vitest 全绿 + tsc + check:file-size + check:arch-boundary + tauri:dev 目检 + localhost sshd 端到端
