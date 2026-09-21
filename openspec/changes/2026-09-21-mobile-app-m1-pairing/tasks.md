# 任务分解:mobile app M1 配对底座

依据:`openspec/changes/2026-09-21-mobile-app-m1-pairing/proposal.md`(边界与取舍);spec `docs/superpowers/specs/2026-09-21-mobile-app-design.md`;契约 `docs/architecture/12-web-remote-access.md`。任务按依赖排序;1-6 为 Rust 桌面侧,7-8 前端 kernel/桌面 UI,9 协议脚本,10-11 壳,12 验证收口,13 文档。

## 1. [前置] relay 数据面 loopback 修复(P1 存量缺陷)

- [x] 1.1 `src-tauri/src/web/server.rs` serve():LAN listener 起后按同端口再绑 `127.0.0.1`(占用则重铸端口重试,上限 3 次);双 listener 各起 axum::serve 共享 Router;停机语义两路同收
- [x] 1.2 单测/实测:起桥后 `127.0.0.1:{port}` 与 `{lan_ip}:{port}` 均可建 TCP;relay_agent 零改动
- [ ] 1.3 验收:relay 已连接态下经 Worker 隧道发 HTTP 请求,桥真实应答(修复前 = 拒绝)

## 2. 设备注册表(devices.rs)

- [x] 2.1 新 `src-tauri/src/web/devices.rs`(~200 行):`Device{deviceId,name,tokenHash,createdAt,lastSeenAt,approved}`;`web_devices.json`(app-data,0600,`{version:1, devices:[…]}`);写盘复用 `crate::session` 原子写
- [x] 2.2 hostId:16 字节随机 hex,app-data `web_host_id` 一次性生成(已存在直读)
- [x] 2.3 配对码生命周期:mint(8 位 `XXXX-XXXX`,gate.rs 字母表,10min TTL,单次消费)→ consume;设备 token 32 字符 CSPRNG,落盘只存 sha-256 hex(复用现有 sha2 依赖)
- [x] 2.4 `validate/approve/revoke/list/touch_last_seen`;revoke 返回被撤 deviceId 供踢 socket
- [x] 2.5 单测:铸码→配对→pending→approve→validate 全链;TTL 过期拒;码单次消费;撤销后 validate 拒;落盘文件无明文 token;0600 权限

## 3. /pair HTTP 面(pair.rs)

- [x] 3.1 新 `src-tauri/src/web/pair.rs`(~120 行):offer 铸造 `{v:1,hostId,name,pairCode,lan?,relay?}` → base64url → `tmd://pair?c=…`(lan 取 WebAccessInfo,relay 已连接才带;name 取主机名,兜底 `tmd-cli`)
- [x] 3.2 `POST /pair {pairCode, deviceName}` → 200 `{deviceId,deviceToken,hostId,name,version}`;码错 403 / 过期 410;不做 URL token 闸(pairCode 即凭据);路由挂 server.rs build_router 一行
- [x] 3.3 按来源 IP 连续失败 5 次 → 429 + `web://pair-alert` 事件;成功清零
- [x] 3.4 单测:状态机矩阵(200/403/410/429);offer JSON 可 base64url 解码回读;节流计数与清零

## 4. WS 双凭据 gate + 连接生命周期(conn.rs)

- [x] 4.1 `/ws` 握手:`?token=`(浏览器,现状零回退)或 `?device=&token=`(设备);两路产出 `ConnScope::{Browser, AppDevice{device_id}}`
- [x] 4.2 设备凭据未授权/被撤:升级后立即 4001 close + reason(`unapproved`/`revoked`);壳据此分流
- [x] 4.3(实施:即时踢 conn.rs LiveGuard + 5s 复查;per-device 连接计数挪 M2 徽标项) 连接存活期 5s 复查 approved,翻 false 即 4001;AppDevice socket 按 device_id 计数(state.rs 增 in-memory 计数,设备行 live 点与 remote_control_active 共用)
- [x] 4.4 hello 帧补 `capabilities: []`;连接泵与复查逻辑抽 `conn.rs`(server.rs 守 300 铁则,只留路由/握手/静态面)(实施:泵/握手在 ws.rs,conn.rs = scope 枚举 + AppDevice 域闸 + scoped dispatch,server.rs 168 行)
- [ ] 4.5 单测:浏览器 token 零回退;设备 4001 两 reason;复查翻false断连;hello 含 capabilities 字段

## 5. dispatch scope 两档

- [x] 5.1 `dispatch()` 与各域 `try_dispatch` 增 `&ConnScope` 形参;每命令一行注释标域归属(实施:不改 dispatch 签名,`conn::dispatch_scoped` 包一层做域闸,域文件零改动)
- [x] 5.2 AppDevice 允许:dispatch_session(列表/回放/活流/发送/审批应答;**拒 session_spawn**)、fs/git 只读命令、misc 域 settings/workspaces/quota/platform 读;拒:全部写命令、dispatch_ssh 全域、sqliteQuery/插件市场/updater/config_write_*
- [x] 5.3 单测拒绝矩阵:AppDevice 写命令/ssh/spawn 拒、读命令通;Browser 全量零回退

## 6. 桌面命令面(lib.rs 登记,dispatch 排除)

- [x] 6.1 `web_pair_offer() -> {url,pairCode,expiresAt}`、`web_devices_list() -> {pending,approved}`(wire 不含 tokenHash)、`web_device_approve(deviceId)`、`web_device_revoke(deviceId)`(撤销即踢该设备 socket)
- [x] 6.2 设备表变更发 `web://devices` 事件;四条命令 lib.rs invoke_handler 登记,web dispatch 显式排除并注释(同 web_access_start/stop 先例)
- [ ] 6.3 `src/kernel/ipc.ts` 补四条命令 wrapper 与 DeviceWire 类型

## 7. transport.ts 远程模式(唯一 kernel 改动点)

- [x] 7.1 `configureRemoteEndpoint({wsUrl,deviceId,token} | null)`:置位后 invoke/listen 走 WebBridge 连远端(wsUrl + `?device=&token=`);浏览器态 location.host + webToken 原样;`isRemote` export
- [x] 7.2 hello 增存 capabilities:`serverCapabilities()` 与 serverVersion 并列;onclose 读 code,4001 → 停止重连 + revoked 态 + 事件通知(壳清凭证回配对屏)
- [x] 7.3 现有浏览器桩目检链路回归(transport 双态不破坏 isWeb 行为)

## 8. 桌面配对 UI(web-access 插件)

- [x] 8.1 新 `src/plugins/web-access/WebDevicePairCard.tsx`(原型 ① 同构):添加设备 → QRCodeSVG(现有依赖)+ 配对码 chip + TTL 倒计时;待授权行(授权/忽略);已授权列表(live 点/上次活跃/踢除);订阅 `web://devices`;`web://pair-alert` 节流告警 toast
- [x] 8.2 `WebAccessSection` 内网卡下挂载配对卡;isWeb 态隐藏(desktop-only)
- [x] 8.3 i18n 三语词条(en/ja 落 kernel locales misc.ts web-access 段先例)
- [ ] 8.4 桩目检:配对卡全交互链(出码→pending→授权→踢除)

## 9. 协议层客户端脚本

- [x] 9.1 `scripts/web-bridge-client.mjs`(Node 22+ global WebSocket):`--offer` / `--url+--code` / `--url+--device+--token` 三入口 → POST /pair → 轮询等授权 → WS(device 凭据)→ hello → invoke session_list → 事件旁听;4001/revoked 退出码 42(实施:--token 浏览器路径与 attach 回放演示并入 12 收口,按需)
- [x] 9.2 LAN 真桥跑通全链 = 协议验收判据(server bug vs UI bug 归因)(2026-09-22 实测:出 offer→/pair 200→pending 4001 轮询→授权→hello capabilities=[app-device]→session_list ok→撤销→4001/revoked 退出 42;dev offer 经 debug 构建 stderr 提供,release 零编译)

## 10. mobile-app/ 壳工程

- [x] 10.1 `mobile-app/package.json` + `mobile-app/src-tauri/`(Cargo 仅 tauri,Rust 零本地命令);tauri.conf.json:frontendDist 指 repo 根 dist、devUrl 1421、bundle id/签名团队配置(com.tmdcli.mobile;签名团队待大仙 Xcode 登录 Apple ID 后取)
- [x] 10.2 壳标记注入 `window.__TMD_SHELL__`(initialization_script 或 userAgent 后缀,按 v2 API 定)(实施:WebviewWindowBuilder.initialization_script,mobile-app/src-tauri/src/lib.rs)
- [x] 10.3 `pnpm tauri ios init` 出 Xcode 工程;`pnpm tauri ios build` 真机可装(模拟器先行)(gen/apple 已出;cargo check --target aarch64-apple-ios-sim 绿。环境注意:homebrew rustc 遮蔽 rustup,iOS 编译须 PATH="$HOME/.cargo/bin:$PATH";IPHONEOS_DEPLOYMENT_TARGET 14→15 已改 project.yml+pbxproj;crate-type 去 cdylib)
- [ ] 10.4 [上游阻断] 模拟器启动验证:tauri-cli 的 iOS Swift shim 未参与链接(Xcode 27 + tauri-cli 2.11.5,xcodebuild 65 undefined symbols _log_stdout/_on_webview_created/_run_plugin_command/_string_from_bytes;上游同族 issue tauri-apps/tauri#14233 开放未解)。跟进:上游适配 / 降级 Xcode 16 验证 / 手工 swift build ios-api 补 libtauri_static.a

## 11. 壳配对屏 + block 屏

- [x] 11.1 `src/app-shell/mobilePairing.tsx` + `mobilePairingScreen.tsx`:粘贴 `tmd://pair` 链接自动解析 / 手输主机+配对码;POST /pair(实施:单端点 6s AbortController,双端点竞速随 relay e2e 一并演练)
- [x] 11.2 `src/main.tsx` 守卫(≤10 行):有 `__TMD_SHELL__` 且无凭证 → 渲染配对屏;有凭证 → configureRemoteEndpoint(读 localStorage)+ 正常装配;桌面零影响(无标记 = 现状)
- [x] 11.3 配对成功 → 试连 WS:4001-unapproved → 「等待桌面授权」重试;hello 到达 → 存凭证 localStorage → 进远程模式;4001-revoked/撤销 → 清凭证回配对屏(实施:ShellGate 4s 轮询 + onRemoteRevoked(reason) 分流)
- [x] 11.4 hello.version/capabilities 不满足壳最低要求 → block 屏(当前版本/要求版本/重试按钮;最低版 0.3.0 钉在 SHELL_MIN_DESKTOP_VERSION;reload 重走门)
- [ ] 11.5 [尝试] tauri 社区 barcode 扫码插件;不顺利降级 M2(粘贴兜底保留)(粘贴/手输已就位,插件随 M2)

## 12. 验证收口

- [x] 12.1 门禁:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`;`cargo test && cargo clippy --all-targets -- -D warnings && cargo fmt --check`(2026-09-22 HEAD 全绿:2741 前端测/280 Rust 测)
- [ ] 12.2 协议脚本 e2e:LAN 与 relay 两路(LAN 已绿见 9.2;relay 路待大仙 settings 配 webRelayUrl/webRelayKey —— 当前为空,offer relay=null)
- [ ] 12.3 桌面真窗口目检:配对卡 QR/TTL/pending/授权/踢除/节流告警(浏览器桩目检已过;真窗口人眼复核待大仙 tauri:dev)
- [ ] 12.4 真机 iOS e2e(用户门):需大仙 Xcode 登录 Apple ID 出签名 + iPhone;上游阻断见 10.4(模拟器启动验证同受累)
- [x] 12.5 `npx react-doctor@latest -y` 100 收口(100/100)

## 13. 文档沉淀

- [ ] 13.1 spec 2026-09-21-mobile-app-design.md 补 M1 实施对照(本提案链接 + 偏离记录:localStorage 凭证/spawn 排除/扫码降级)
- [ ] 13.2 architecture/12-web-remote-access.md 增补:hello capabilities、双凭据 gate、dispatch scope、loopback 双绑(M3 定稿前先行记录)
- [ ] 13.3 本目录归档 openspec/changes/archive/(随 M1 收口提交)

## 明确不做(M1)

移动断点 UI 打磨 / RemoteHostBar / 本地通知 / 凭证 app-data+钥匙串 / 徽标设备名 hover / 相机扫码保底外投入 / E2EE / 终端键盘输入 / session_spawn 开放 / Android 壳。
