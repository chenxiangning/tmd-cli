# 提案:mobile app M1 配对底座(mobile-app-m1-pairing)

## Why

依据:`docs/superpowers/specs/2026-09-21-mobile-app-design.md`(已评审通过)§A 身份与配对、§B 服务面按域裁剪、§C 壳工程与 transport 参数化、§E 协议层客户端;交互定稿见 `docs/prototypes/mobile-app-*.html` 四页。

用户拍板(2026-09-21):M1 边界 = **桌面配对全家桶 + iOS 壳脚手架,真机 e2e 跑通配对**;配对链路 **LAN 与 relay 双通**(relay Worker/Agent 的 HTTP 隧道本就 generic,`/pair` 零 Worker 改动,见下)。

M1 交付后:桌面出码 → 手机扫码/粘贴 → 桌面授权 → 手机经 LAN 或 relay 连上桌面并看到会话列表;撤销即 4001 断连回配对屏。移动断点 UI 打磨、通知、相机扫码(若降级)归 M2。

## 前置:已发现存量缺陷(P1,随 M1 首任务修复)

`d227f8c` 把桥绑定从 `0.0.0.0:0` 收窄到 `{lan_ip}:0`(防 VPN 全接口可达,动机正确),但 relay_agent 按 `http://127.0.0.1:{port}` / `ws://127.0.0.1:{port}` 回拨本机桥(relay_agent.rs:227/:322)——绑 LAN IP 的 listener 不接受 loopback 连接(本机实测:绑 192.168.1.7 后拨 127.0.0.1 = Connection refused)。**即 relay 数据面当前整体断**:agent 外拨 Worker 的「已连接」状态不受影响,表象静默,手机经 relay 的首个请求即失败。修复 = 同端口加绑 `127.0.0.1` 第二 listener,Router 共享,relay_agent 零改动。

## What Changes

### 1. Rust 桌面侧(`src-tauri/src/web/`)

- **loopback 修复**(server.rs):LAN listener 起后按同端口再绑 `127.0.0.1`(占用则重铸端口重试);axum::serve 双 listener 共享 Router。
- **`devices.rs`**(新,预估 ~200 行,守 300 铁则):设备注册表。
  - `web_devices.json`(app-data,0600):`{version:1, devices:[{deviceId, name, tokenHash, createdAt, lastSeenAt, approved}]}`;写盘复用 `crate::session` 原子写;tokenHash = sha-256 hex(复用现有 sha2 依赖),**不明文落盘**。
  - hostId:16 字节随机 hex,app-data `web_host_id` 一次性生成。
  - 配对码:8 位 `XXXX-XXXX`(复用 gate.rs 去歧义字母表),10 分钟 TTL,单次消费。
  - 设备 token:32 字符 CSPRNG;`validate(device_id, token)` = hash 比对 + approved;`approve/revoke/list/touch_last_seen`;单测覆盖生命周期、TTL、单次消费、撤销即失效、节流计数。
- **`pair.rs`**(新,~120 行):HTTP 配对面。
  - offer 铸造:`{v:1, hostId, name, pairCode, lan?, relay?}` → base64url → `tmd://pair?c=…`;lan 取 WebAccessInfo,relay 取 relay 状态(已连接才带)。
  - `POST /pair {pairCode, deviceName}` → 200 `{deviceId, deviceToken, hostId, name, version}`;码错 403 / 过期 410 / 节流 429。**不做 URL token 闸**(pairCode 即凭据);按来源 IP 连续失败 5 次节流 + 发 `web://pair-alert`(学 orca UnpairedDeviceAuthThrottle)。
- **gate 双凭据**(server.rs/gate.rs):`/ws` 握手接受 `?token=`(浏览器,现状零回退)或 `?device=&token=`(app 设备)。设备凭据未授权/被撤:**升级后立即 4001 close + reason(unapproved/revoked)**——壳可区分「被撤」与「网络断」;连接存活期 5s 复查 approved,翻 false 即 4001(继承 codemoss 纪律);AppDevice socket 按 device_id 计数(设备行 live 点)。hello 帧补 `capabilities: []`(E2EE 等升级位;壳侧 min-version 据此硬 block)。
- **dispatch scope 两档**:`ConnScope::{Browser, AppDevice{device_id}}` 从握手透传 dispatch;各域 `try_dispatch` 增 scope 形参,每命令一行注释标域。AppDevice 允许域:session(列表/回放/活流/发送/审批应答;**不含 session_spawn**,v1 手机不开新会话)+ fs/git 只读 + settings/workspaces/quota 读;拒绝:全部写命令、ssh 全域、sqlite/插件市场/updater 等。Browser 全量零回退。
- **桌面命令面**(web_access.rs 增补,lib.rs invoke_handler 登记):`web_pair_offer() -> {url, pairCode, expiresAt}`、`web_devices_list() -> {pending, approved}`(wire 不含 tokenHash)、`web_device_approve(deviceId)`、`web_device_revoke(deviceId)`(撤销即踢 socket);变更发 `web://devices` 事件。**dispatch 不镜像**(desktop-only,同 web_access_start/stop 排除先例)——app 设备永远不能自批。
- server.rs 249 行 + 新增将超限:连接泵与 5s 复查抽 `conn.rs`,server.rs 只留路由/握手/静态面。

### 2. 前端 kernel(`src/kernel/transport.ts`,唯一 kernel 改动点)

- `configureRemoteEndpoint({wsUrl, deviceId, token} | null)`:置位后 invoke/listen 一律走 WebBridge 连远端(壳 webview 有 `__TAURI_INTERNALS__`,isWeb 探测对壳失效,故远程模式显式化);浏览器态 `location.host + webToken` 原样。
- hello 增存 capabilities,`serverCapabilities()` 与 `serverVersion()` 并列;onclose 拿 code:**4001 → 停止重连、置 revoked 态、发事件**(壳清凭证回配对屏);`isRemote` export。
- ipc.ts 零感知;R3 边界不变。

### 3. 桌面 UI(`src/plugins/web-access/`)

- 新 `WebDevicePairCard.tsx`(原型 ① 同构):「添加设备」→ `web_pair_offer` → QRCodeSVG(qrcode.react 现有依赖)渲染 `tmd://pair` URL + 配对码 chip + TTL 倒计时;待授权行(授权/忽略)与已授权列表(live 点/上次活跃/踢除),订阅 `web://devices`;节流告警 toast。
- `WebAccessSection` 在内网卡下挂载配对卡;i18n 三语词条按 web-access 段先例落位。RemoteControlBadge 不动(计数已含设备 socket;设备名 hover 归 M2)。

### 4. `mobile-app/` 壳(Tauri 2, iOS 先行)

- 薄壳工程:`mobile-app/package.json` + `mobile-app/src-tauri/`(Cargo 仅 tauri;**Rust 零本地命令**);`tauri.conf.json` frontendDist 指 repo 根 `dist/`,devUrl 复用 1421;`pnpm tauri ios init` 出 Xcode 工程(bundle id / 签名团队实施期配)。
- 壳标记:Builder 定制窗口注入 `window.__TMD_SHELL__`(initialization_script 或 userAgent 后缀,按 v2 API 实施期定);前端凭此分流。
- `src/app-shell/mobilePairing.tsx` + `src/main.tsx` 守卫(≤10 行):有标记且无凭证 → 渲染配对屏(粘贴 `tmd://pair` 链接自动解析 / 手输主机+配对码;LAN、relay 双端点竞速 POST /pair)→ 拿到凭据试连 WS,4001-unapproved 则「等待桌面授权」5s 重试,hello 到达即存凭证(localStorage,见取舍)并 `configureRemoteEndpoint` 进入正常装配;hello.version/capabilities 不满足壳最低要求 → block 屏(重试按钮)。相机扫码:tauri 社区 barcode 插件尝试同批,不顺利降级 M2(粘贴兜底已够演示)。
- M1 壳验收线:配对 e2e + 远程 home 会话列表渲染 + 打开会话看实况;移动断点/composer/审批卡打磨归 M2。

### 5. 协议层客户端(`scripts/web-bridge-client.mjs`)

裸 WS 协议脚本(Node 22+ global WebSocket):`--url/--pair-code/--device-name` 走 配对 → 等授权 → WS 连接 → hello → invoke(session_list)→ 事件 → attach 回放演示;支持 `--token` 浏览器路径;`--expect-revoke` 断言撤销后 4001。LAN 与 relay(wss://worker)两路各跑通 = M1 协议验收判据(server bug vs UI bug 归因用,学 orca test-subscribe.ts)。

## 方案取舍(相对 spec 的偏离,均收窄)

| 点 | 本提案 | spec 原文 | 理由 |
|---|---|---|---|
| 壳凭证存储 | webview localStorage(M1) | app-data 文件先行,钥匙串后补 | 壳 Rust 零命令边界不破(invoke 全走远程即正确语义);localStorage = 浏览器态 tmd.settings.v1 同款先例;iOS 清理 webview 存储的代价 = 重新配对一次,可接受。app-data/钥匙串归 M2 硬化 |
| 设备 WS 未授权 | 升级后 4001 close | 同 spec | 壳可读 close code 区分 revoked/unapproved/网络断,浏览器 WebSocket 拿不到 HTTP 403 细节 |
| AppDevice 命令域 | 不含 session_spawn | session(列表/回放/活流/发送/审批) | spec 域内本无 spawn;v1 轻交互 = 看现有会话,手机不开新会话 |
| 相机扫码 | 粘贴+手输保底,扫码插件尝试 | 实施期定 | 保底路径零依赖即可演示;插件集成不顺不拖 M1 收口 |

## 验证

- 门禁:前端 `pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`;Rust `cargo test && cargo clippy --all-targets -- -D warnings && cargo fmt --check`;收口 `npx react-doctor@latest -y` 100。
- Rust 单测:devices 生命周期(TTL/单次消费/撤销/hash 不明文)、/pair 节流、gate 双凭据(浏览器 token 零回退 + 设备 4001)、dispatch scope 拒绝矩阵(AppDevice 写命令/ssh/spawn 拒、读命令通、Browser 全量)。
- 协议脚本 e2e:LAN 与 relay 两路各跑通 配对 → 授权 → 连接 → invoke → 事件 → 回放;撤销 → 4001;loopback 修复后 relay 数据面复活实测。
- 桌面真窗口目检(`pnpm tauri:dev`):配对卡 QR/TTL/pending/授权/踢除;节流告警。
- 真机 iOS:`pnpm tauri ios build` 实机:粘贴配对 → 桌面授权 → 远程 home;切 LAN/relay 各验;撤销 → 回配对屏;block 屏(注水 version 演练)。

## 里程碑图

- **M1 配对底座(本提案)**:身份/设备表/配对流(LAN+relay)/双凭据 gate/dispatch scope/hello caps/桌面配对 UI/壳脚手架+transport 远程模式+配对屏/协议脚本。
- M2 轻交互闭环:移动断点 UI(侧栏/composer/审批卡/RemoteHostBar)/相机扫码(若 M1 降级)/本地通知/凭证 app-data+钥匙串/徽标设备名。
- M3 v1 发布候选:Android 壳评估、真机矩阵、architecture/12 契约修订沉淀(M1 内先记决策,M3 定稿)。
