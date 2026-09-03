# SSH 插件实施计划

对齐 `docs/superpowers/specs/2026-09-04-ssh-plugin-design.md`。每项完成即勾。

## 1. Rust 引擎

- [ ] Cargo.toml 加 russh 0.62.2 / russh-sftp 2.3;`cargo check` 通过
- [ ] `ssh/mod.rs`:SshRegistry + 会话状态机(连接代际/重连标志/prompt 表)
- [ ] `ssh/transport.rs`:TCP 直连 + HTTP CONNECT/SOCKS5 握手 + 代理解析(含单测)
- [ ] `ssh/auth.rs`:认证材料解析(password/privateKey+passphrase/KBI)+ PEM 清洗 + 路径展开(含单测)
- [ ] `ssh/known_hosts.rs`:JSON 存储 + SHA256 指纹 + 校验/信任/重置(含单测)
- [ ] `ssh/session.rs`:create/orchestration、PTY 通道、IO 泵(`pty://out/{id}`+session_log)、input/resize/kill、keepalive、有界重连、prompt 事件/应答、延迟探测
- [ ] `ssh/sftp.rs`:SFTP 注册表(代际失效)+ list/stat/read/write(乐观并发)/mkdir/rename/delete/upload/download(进度事件,含单测)
- [ ] `ssh/forward.rs`:`-L` 转发注册表 + 自动端口 + check_port + 级联停止(含单测)
- [ ] `ssh/commands.rs` + lib.rs 注册 + session.rs kind 字段 + write/resize/kill 路由
- [ ] `cargo test && cargo clippy --all-targets -- -D warnings && cargo fmt --check`

## 2. 内核契约

- [ ] `ipc.ts`:SessionMeta.kind、SSH 契约类型、命令封装、onSshEvent/onSshPrompt 订阅
- [ ] `settings.ts`:`ssh.hosts` 域 + sanitize + 默认值(含单测)
- [ ] `host.ts`:createSshSession(复用 adoptSpawned)、appendOutput 按 kind 跳过 askWatch
- [ ] `plugin.ts`:挂载点 `workspace.newSessionMenu`
- [ ] vitest 全绿 + typecheck + check:arch-boundary + check:file-size

## 3. 前端插件

- [ ] `ssh/{types,state}.ts`:状态仓(ssh://event 订阅:状态/转发/SFTP 进度)
- [ ] `ssh/scan.ts`:`~/.ssh/config` 解析 + identity 路径跨平台展开(含单测,照搬竞品用例)
- [ ] `ssh/picker/HostPicker.tsx`:overlay 主机选择 + 新建会话
- [ ] `ssh/panel/`:SshPanel(连接卡/延迟/断开)+ ForwardSection(启停/预检)+ SftpTree(懒展开)
- [ ] `ssh/settings/`:SshSettingsSection + HostModal(三认证/代理/私钥导入)+ ImportModal(扫描导入)
- [ ] `ssh/editor/`:RemoteFileTab(CodeMirror)+ remoteFileIo(乐观并发写回)
- [ ] `src/plugins/index.ts` 注册;`src/styles/ssh.css`

## 4. 外壳集成

- [ ] `workspace/SessionMenu.tsx`:渲染 `workspace.newSessionMenu` Mounts
- [ ] `workspace/SessionList.tsx`:kind==="ssh" 会话 SSH 分组
- [ ] `AppShell.tsx`:ssh 会话隐藏 composer

## 5. 验证

- [ ] 全套前端门禁命令 + Rust 门禁命令
- [ ] `pnpm tauri:dev` 目检:设置/导入、新建入口、幕布会话、右栏面板、编辑器 tab、composer 隐藏
- [ ] localhost sshd 端到端:私钥认证、known_hosts 信任流、SFTP 读写、端口转发 curl
