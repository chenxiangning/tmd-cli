# 提案:Web 远程访问(web-remote-access)

## Why

需求:手机(iPhone)在外网访问电脑上的 tmd-cli(看会话/发消息/批审批)。前置调研已定稿两份:

- `docs/research/mobile-remote-access.md`:三层解耦选型(服务面 × 通道 × 壳),确认 tmd-cli 无任何 HTTP/WS 服务面,服务面是唯一绕不开的自研件。
- `docs/research/codemoss-web-remote.md`:codemoss 同功能源码级分析(web.rs 1865 行 LAN 桥 + relay.rs 1903 行出站中继 + CF Worker 250 行 + transport.ts 传输抽象 + 完整治理面),结论 = 架构可直接对标,且 tmd-cli 有两个结构性优势(事件发送点仅 6 处、插件语义全在前端 TS)。

本提案 = codemoss 架构向 tmd-cli 的移植,分 M1(LAN 桥)/ M2(出站中继)两期;iOS 壳另案。

## What Changes

### M1:LAN Web 桥 + 设备配对

**Rust(宿主机制,入 kernel 合规)**:

- 新增 `src-tauri/src/event_sink.rs`:`EventSink` + `BroadcastEmit`(事件单源,扇出 = webview + WS 广播者;32ms/64KB 批量,chat 类 16ms —— 参数照 codemoss)。现有 6 处 `app.emit` 调用点(installer/pty_spawn/pr_workflow/ssh forward·io·mod/session_prompt/sftp)改走 sink,行为不变。
- 新增 `src-tauri/src/web/`(axum;守 300 行铁则拆 `mod/state/gate/server/dispatch/devices`):
  - 静态前端复用 Tauri embedded frontendDist;`/ws` 桥:`{type:"invoke",id,cmd,args}` → `{type:"response",id,ok,payload|error}`,首帧 hello 带版本,事件经 broadcast 原样转发;
  - 安全:LAN 认 URL `?token=`(每次启动新铸);设备配对四态(8 位配对密钥 → pending 行 → 桌面批准 → HttpOnly cookie);每条 socket 5s 复查批准;`RemoteSession` RAII 计数 → 「远程控制中」徽标;
  - `/file` 路由:scope **收窄**为 $HOME 排除 `~/.tmd-cli`/`~/.ssh`/`~/.aws`/各 CLI 凭据目录,canonicalize 防逃逸;
  - 桥响应自带 CSP 头(web 表面无 Tauri CSP 注入:`connect-src 'self' ws:` 等);
  - dispatch 按域白名单:fs/git/checkpoints/pty(session 族)/ssh/config/settings/quota/sqliteQuery/wsl;排除 updater/process/dialog/shell.open/插件市场安装/web_access 自身 start·stop(desktop-only)。
- 新依赖:axum + tokio-tungstenite(reqwest/tokio 已有,复用)。

**前端**:

- 新增 `src/kernel/transport.ts`:`isWeb = !__TAURI_INTERNALS__` 检测;`WebBridge` 提供与 `@tauri-apps/api` 同签名 invoke/listen(WS,1s→10s 重连);6 个 `@tauri-apps/*` import 从 ipc.ts 下沉至此;桌面专属 API(window/uiZoom/updater/dialog/shell/process)在 web 态降级 no-op/隐藏;`convertFileSrc` → `/file?path=` 映射。
- `src/kernel/ipc.ts` 改从 `./transport` 导入,897 行命令面零改动;`scripts/check-arch-boundary.mjs` R3 白名单改指 transport.ts(一行,语义不变)。
- 新插件 `src/plugins/web-access/`:设置分区(内网卡:启停 + token URL + 二维码;授权卡:开关 + 配对密钥展示/轮换;设备卡:待批准/已批准列表,批准·改名·踢除 desktop-only 按钮)+ 「远程控制中」徽标挂点。一切贡献经 `activate(ctx)` 注册面。

### M2:出站中继(无 ECS 外网)

- 新增 `src-tauri/src/web_relay/`:桌面主动外拨 `wss://<worker>/agent?key=`,单条 WSS 多路复用(open/body/end/data/head/close/error,base64);每流转成对 127.0.0.1:bridge 的普通请求并打 `x-tmd-via` 头(闸门仍全在桥);重拨 1s→30s 封顶 + 15s 心跳 + 20s 拨号超时 + autostart(设置持久化)。
- 新增 `deploy/worker/`(Cloudflare Worker + Durable Object,~250 行,照 codemoss 线协议自实现);`relay_deploy` 内嵌 Worker 源码经 reqwest 调 CF API 一键部署(user token 自动列账户 / cfat_ 令牌要 Account ID);备选 `relay_deploy_pack` 导 STORE zip。
- 插件补外网卡:风险确认弹窗(一次性,文案明写「权限与本机完全相同」)→ 部署卡 → 连接卡(URL+key+状态点)。

### 明确降级 / 遗留(如实标注)

- **手机端 xterm 触摸弱**(xterm.js 官方 #5377):M1/M2 手机定位「看 + 发消息 + 批审批」轻交互;移动键盘工具条/触摸优化留 iOS 壳提案。
- **/file scope 收窄 = trust-boundary 变更**(现 assetProtocol 为 `**/*`,tauri.conf.json:19):web 面 $HOME 排除凭据目录,配单测(白名单内放行/凭据目录拒绝/symlink 逃逸拒绝)。
- 桌面专属 API 浏览器端降级,不做等价物(更新检查/目录选择/窗口控制在手机无意义)。
- 设备批准/踢除保持 desktop-only(比 codemoss 收窄一档:手机端只读状态)。

### 不做(另案或明确排除)

- iOS 原生壳 / Tauri 2 iOS / PWA 主屏打包优化(依赖本提案,另案);
- WireGuard/frp/Tailscale 等其它通道(relay 已覆盖无 ECS 场景;有 ECS 的用户可自建 WG 直连 LAN 桥,零增量);
- IM/Bot 通道;全量命令面以外的「手机专属 UI 重构」。

## Capabilities

### New Capabilities

- `web-access`:LAN Web 桥(静态前端 + WS 命令/事件桥 + token 闸门 + 设备配对 + 远程控制徽标)+ 设置治理面。
- `web-relay`:出站 Cloudflare Worker 中继(零入站端口外网可达)+ 一键部署 + autostart。

### Modified Capabilities

- (无现有 spec 能力被改;R3 唯一 import 点载体从 ipc.ts 换到 transport.ts 属检查规则实现细节,记入 design)

## Impact

- **新增(Rust)**:`event_sink.rs`(~150 行)、`src-tauri/src/web/`(~1200 行拆 6 文件)、`web_relay/`(~600 行拆 3 文件)、`deploy/worker/`(~250 行 JS);新依赖 axum、tokio-tungstenite。
- **新增(TS)**:`src/kernel/transport.ts`(~180 行)、`src/plugins/web-access/`(~400 行);新依赖 qrcode.react。
- **修改**:`src/kernel/ipc.ts`(import 源切换)、`scripts/check-arch-boundary.mjs`(R3 白名单一行)、6 处 `app.emit` 调用点、`src/plugins/index.ts`(allPlugins 一行)、设置 schema(webAuth*/webRelay* 四字段)。
- **架构边界**:kernel 新增的是「会话远程可达性」宿主机制,合规;UI 全部走插件注册面;cli-shared 不动;幕布铁律不变(PTY 字节原样过 WS,幕布侧零二次渲染)。
- **门禁**:前端五件套 + `cargo test && cargo clippy --all-targets -- -D warnings && cargo fmt --check`;**验收硬门 = iPhone Safari 真机双通道目检**(LAN 直连 + relay 外网,各跑一次「开会话 → 看输出 → 发消息 → 审批 → revoke 踢线」)。
- **文档**:落地后沉淀 `docs/architecture/NN-web-remote-contract.md`;两份 research 已登记索引。
