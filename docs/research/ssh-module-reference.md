# 参考实现 SSH 模块调研(竞品参考)

日期:2026-09-04
状态:完成(tmd-cli SSH 插件设计的竞品参考底稿)

结论先行:参考实现的 SSH 模块是基于 russh 0.62.2 + russh-sftp 2.3 的生产级实现,横跨 Rust 引擎、共享 React UI、Go 网关三层,同时充当内嵌终端客户端、SFTP 文件管理器、端口转发面板、AI Agent 远程操作工具四个角色。完成度远超 demo;短板是凭据明文存储与缺 ssh-agent/jump host。tmd-cli 复刻取其引擎与 UI 逻辑,不取网关中继(tmd-cli 无网关层)与 AI 工具化(tmd-cli 的 agent 是宿主内的 CLI,不是 tmd-cli 本身)。

## 一、三层架构

```
浏览器 WebUI ──WS(protobuf)── Go Gateway(纯中继+权限门) ──┐
                                                            │
桌面 React UI(终端 Pane/隧道面板/SFTP 浏览器) ─────────────┤
                                                            ▼
                          Rust 引擎(src-tauri/src/runtime/terminal/):
                          ssh_connect(传输+代理+host key) → ssh_auth(认证)
                          → ssh_channel(shell/SFTP/exec) → ssh_io(PTY 泵)
                          → ssh_session(生命周期/重连);ssh_local_forward(-L);
                          runtime/sftp.rs(SFTP 会话注册表)
```

- 桌面 Rust 端是唯一 SSH 执行引擎;网关只做帧转发与 `enableWebSshTerminal` 权限门(默认拒绝)。
- 桌面与 Web 共用同一套 `agent-ui` 组件,各端只换适配器(tauriSftpClient / gatewaySftpClient)。

## 二、引擎细节(Rust,复刻的直接对象)

| 能力 | 实现要点 | 文件 |
|---|---|---|
| 传输+代理 | 手写 HTTP CONNECT / SOCKS5 握手;代理配错快速失败不静默直连 | ssh_connect.rs(`http_connect_proxy`/`socks5_connect_proxy`/`write_socks5_address`) |
| 认证 | password/privateKey/keyboard-interactive;KBI 多轮上限 5 轮可回落密码;私钥 PEM 清洗与跨平台路径展开 | ssh_auth.rs(`resolve_ssh_auth_material`/`continue_keyboard_interactive_auth`) |
| host key | SQLite `ssh_known_hosts`(host+port 键,base64+SHA256 指纹);首连信任 prompt 120s 超时 | commands/config/settings/ssh/load.rs |
| 会话编排 | create/answer_prompt/cancel_prompt;自动重连 3 次(2/5/10s 退避,单次 20s 超时);keepalive 30s×3;延迟探测 | ssh_session.rs、mod.rs 常量 |
| IO 泵 | channel split + writer task + resize;ping 探活触发重连 | ssh_io.rs |
| 通道 | PTY(xterm-256color)+ shell / 同连接开 sftp subsystem(不重认证)/ exec 捕获三通道 | ssh_channel.rs |
| 端口转发 | `-L`:127.0.0.1 绑定(port 0 自动分配)、`channel_open_direct_tcpip` + 双向拷贝、watch 取消、会话关闭级联;内嵌 4 单测 | ssh_local_forward.rs |
| SFTP | list/stat/read_text(分页/截断)/write_text(mtime+size 乐观并发)/mkdir/rename/递归 delete/递归传输(64KB 缓冲、进度事件、取消);连接代际失效重建;symlink 安全单测 | runtime/sftp.rs |

## 三、UI 层(复刻交互逻辑)

- 主机管理:设置页 SshSection(三种认证、代理、私钥文件导入、留空保留旧密钥、known_hosts 重置、编辑后重连提示、删除级联);`~/.ssh/config` 扫描导入(Host/User/Port/IdentityFile 解析,identity 路径跨平台展开:`~`/`$HOME`/`%USERPROFILE%`/`${HOME}`/UNC,PEM 头校验后内联私钥内容,host 去重)。
- 隧道面板 SshTunnelPanel(约 1700 行):会话卡片(状态/延迟/重连)+ 内嵌转发列表(复制地址/停止/错误条)+ 新建映射模态(端口占用预检 blur+提交两次、本地端口留空自动分配)+ SSH prompt 应答流(host key 信任/KBI)。
- SFTP:双栏浏览器(面包屑/拖拽传输/右键上传下载/进度队列)+ Monaco 远程编辑(`createRemoteSftpEditorFileIo` 写回带冲突检测)。
- AI 工具化 `ssh_manager`(19 action,桌面专属):安全纪律——KBI 主机不自行拨号、项目关联主机授权边界、凭据脱敏、917 行专项测试。

## 四、短板(复刻时规避或接受)

1. 凭据明文:password/privateKey/passphrase 明文进 SQLite(`Connection::open` 裸开,无加密无 keychain);仅 Web 同步链路脱敏。tmd-cli 决策:同样明文(settings.json 惯例),spec 记录风险。
2. 协议缺口:无 ssh-agent、jump host(ProxyJump)、压缩、`-R`/`-D`。tmd-cli v1 同样不做。
3. `WorkspaceSftpPanel` 无测试;代理握手手写协议维护成本自担(照搬,含单测)。

## 五、对 tmd-cli 的映射结论

| 参考实现 概念 | tmd-cli 落点 |
|---|---|
| SSH Terminal Pane(workbench) | 一等会话:中央幕布 + 顶栏 tab + 会话列表(用户已裁决) |
| SFTP 浏览器 + Monaco 远程编辑 | 右栏 SFTP 树 + 中央编辑器 tab(用户已裁决) |
| SshTunnelPanel | 右栏 SSH 面板的转发分区 |
| SshSection 设置 + ~/.ssh/config 扫描 | 设置页 SSH 分区 + 扫描导入(逻辑照搬) |
| Go 网关中继/权限门 | 不复刻(tmd-cli 单机,无网关) |
| ssh_manager AI 工具 | 不复刻(tmd-cli 不是 agent 本体) |
