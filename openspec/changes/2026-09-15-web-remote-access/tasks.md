# 任务分解:Web 远程访问

前置:调研两份已落盘登记(mobile-remote-access / codemoss-web-remote)。M1 先行,M2 紧随,iOS 壳另案。

## 1. Rust 事件单源(src-tauri)

- [ ] 1.1 `event_sink.rs`:`Emit` trait + `BroadcastEmit`(webview + N 个 WS 广播者,目标 Arc 克隆出锁再发)+ `EventSink`(32ms/64KB 批量,chat 类 16ms;照 codemoss 参数)
- [ ] 1.2 六处 `app.emit` 改 sink(installer.rs:139/187、pty_spawn.rs:221/228/245、pr_workflow.rs:71/84、ssh/forward.rs:225、ssh/io.rs:41、ssh/mod.rs:220/242、session_prompt.rs:68、sftp.rs:148);行为回归:PTY 输出/退出/ssh 事件/sftp/安装进度/pr 阶段全达前端

## 2. Rust Web 桥(src-tauri/src/web/)

- [ ] 2.1 `state.rs`:WebAccessState(Mutex<Option<Running>> + transition 线性化)+ WebAccessInfo{url,port,token,lanIp};`lan_ip()` RFC1918 优先、排除 198.18.0.0/15 VPN 假网卡
- [ ] 2.2 `server.rs`:axum 路由(静态 dist 复用 embedded frontendDist / `/ws` / `/file` / `/unlock`);CSP 响应头;hello 帧带版本;invoke 独立 task
- [ ] 2.3 `gate.rs`:token 校验 + `relayed()` 双条件(via 头 + loopback)+ 配对页/等待页/批准 cookie(HttpOnly,Lax)
- [ ] 2.4 `devices.rs`:web_devices 表(id/user_agent/created_at/last_seen_at/approved_at/name)+ 批准/改名/踢除命令 + 5s 复查踢线 + 配对密钥定时轮换
- [ ] 2.5 `dispatch.rs`:按域白名单(fs/git/checkpoints/pty/ssh/config/settings/quota/sqliteQuery/wsl)+ 桌面专属排除(updater/process/dialog/shell.open/market install/web_access start·stop);单测:白名单内通、排除项 unknown
- [ ] 2.6 `/file` scope 收窄($HOME 排除 ~/.tmd-cli、~/.ssh、~/.aws、CLI 凭据目录)+ canonicalize;单测:白名单放行/凭据拒绝/symlink 逃逸拒绝
- [ ] 2.7 `RemoteSession` 计数 + `remote_control_active` 命令 + 徽标事件
- [ ] 2.8 `web_access_start/stop/status` 命令接入 lib.rs 装配;dev 环境变量 autostart(照 CCGUI_WEB_AUTOSTART 先例)

## 3. 前端 transport 层

- [ ] 3.1 `src/kernel/transport.ts`:isWeb 检测 + WebBridge(invoke/listen drop-in + pending map + 1s→10s 重连 + serverVersion)
- [ ] 3.2 ipc.ts 6 个 @tauri-apps import 下沉 transport.ts;桌面专属 API(window/uiZoom/updater/dialog/shell/process/convertFileSrc)web 态降级分支;`check-arch-boundary.mjs` R3 白名单改指 transport.ts
- [ ] 3.3 桩目检:浏览器直开 http://127.0.0.1:1421 加 isWeb 桩跑通首屏(FileTree/会话列表/设置)

## 4. web-access 插件(src/plugins/web-access/)

- [ ] 4.1 设置分区:内网卡(启停 + token URL + qrcode.react 二维码 + 复制)
- [ ] 4.2 授权卡:开关 + 8 位配对密钥展示/复制/手动轮换
- [ ] 4.3 设备卡:待批准(批准按钮)/已批准(改名 IME 安全/踢除);desktop-only 操作,web 端只读
- [ ] 4.4 「远程控制中」徽标挂点(remote_control_active 首读 + 事件订阅)
- [ ] 4.5 allPlugins 注册一行 + 桩目检四卡

## 5. M2 出站中继

- [ ] 5.1 `src-tauri/src/web_relay/`:出站 WSS 客户端(单连多路复用 open/body/end/data/head/close/error,base64)+ 每流转 127.0.0.1:bridge 请求打 via 头;HOP_HEADERS 剥离
- [ ] 5.2 重拨(1s→30s 封顶,仅开关停)+ 15s 心跳 + 20s 拨号超时 + autostart(设置 webRelayUrl/webRelayKey 持久化,lib.rs 启动重连)
- [ ] 5.3 `deploy/worker/`:CF Worker + Durable Object(~250 行;agent 顶换/流表/30s head 超时/文本帧保形)
- [ ] 5.4 `relay_deploy`(include_str 内嵌 Worker + reqwest 调 CF API:列账户/cfat_ 要 Account ID/一次上传含 DO 迁移+绑定+密钥)+ `relay_deploy_pack`(STORE zip 手写)
- [ ] 5.5 插件外网卡:风险弹窗(一次性 localStorage)→ 部署卡(API token 仅内存)→ 连接卡(URL+key+状态点带错误 tooltip)

## 6. 验证

- [ ] 6.1 cargo test/clippy -D warnings/fmt 全绿;gate/dispatch/file-scope 单测齐
- [ ] 6.2 前端五件套全绿;transport 契约测试(mock WS 双端:invoke 往返/事件分发/重连)
- [ ] 6.3 **真机硬门**:iPhone Safari 双通道目检 —— LAN(?token= 直连)与 relay(外网)各跑「开会话 → 看 PTY 输出 → 发消息 → 审批 → 设备改名 → revoke 踢线」全链
- [ ] 6.4 桌面回归:webview 内全部既有行为不变(事件改道 sink 后 PTY/ssh/审批/pr 阶段零漂移)

## 7. 收口

- [ ] 7.1 `docs/architecture/NN-web-remote-contract.md`(WS 协议/闸门模型/relay 线协议/事件单源/scope 收窄清单)
- [ ] 7.2 docs/README:契约行登记;AGENTS.md 评估(R3 载体说明是否补一句)
- [ ] 7.3 提交收口:react-doctor 100;提交信息 type(scope) 中文祈使
