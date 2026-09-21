# 任务分解:mobile app M1 配对底座

依据:`openspec/changes/2026-09-21-mobile-app-m1-pairing/proposal.md`(边界与取舍);spec `docs/superpowers/specs/2026-09-21-mobile-app-design.md`;契约 `docs/architecture/12-web-remote-access.md`。任务按依赖排序;1-6 为 Rust 桌面侧,7-8 前端 kernel/桌面 UI,9 协议脚本,10-11 壳,12 验证收口,13 文档。

## 1. [前置] relay 数据面 loopback 修复(P1 存量缺陷)

- [ ] 1.1 `src-tauri/src/web/server.rs` serve():LAN listener 起后按同端口再绑 `127.0.0.1`(占用则重铸端口重试,上限 3 次);双 listener 各起 axum::serve 共享 Router;停机语义两路同收
- [ ] 1.2 单测/实测:起桥后 `127.0.0.1:{port}` 与 `{lan_ip}:{port}` 均可建 TCP;relay_agent 零改动
- [ ] 1.3 验收:relay 已连接态下经 Worker 隧道发 HTTP 请求,桥真实应答(修复前 = 拒绝)

## 2. 设备注册表(devices.rs)

- [ ] 2.1 新 `src-tauri/src/web/devices.rs`(~200 行):`Device{deviceId,name,tokenHash,createdAt,lastSeenAt,approved}`;`web_devices.json`(app-data,0600,`{version:1, devices:[…]}`);写盘复用 `crate::session` 原子写
- [ ] 2.2 hostId:16 字节随机 hex,app-data `web_host_id` 一次性生成(已存在直读)
- [ ] 2.3 配对码生命周期:mint(8 位 `XXXX-XXXX`,gate.rs 字母表,10min TTL,单次消费)→ consume;设备 token 32 字符 CSPRNG,落盘只存 sha-256 hex(复用现有 sha2 依赖)
- [ ] 2.4 `validate/approve/revoke/list/touch_last_seen`;revoke 返回被撤 deviceId 供踢 socket
- [ ] 2.5 单测:铸码→配对→pending→approve→validate 全链;TTL 过期拒;码单次消费;撤销后 validate 拒;落盘文件无明文 token;0600 权限

## 3. /pair HTTP 面(pair.rs)

- [ ] 3.1 新 `src-tauri/src/web/pair.rs`(~120 行):offer 铸造 `{v:1,hostId,name,pairCode,lan?,relay?}` → base64url → `tmd://pair?c=…`(lan 取 WebAccessInfo,relay 已连接才带;name 取主机名,兜底 `tmd-cli`)
- [ ] 3.2 `POST /pair {pairCode, deviceName}` → 200 `{deviceId,deviceToken,hostId,name,version}`;码错 403 / 过期 410;不做 URL token 闸(pairCode 即凭据);路由挂 server.rs build_router 一行
- [ ] 3.3 按来源 IP 连续失败 5 次 → 429 + `web://pair-alert` 事件;成功清零
- [ ] 3.4 单测:状态机矩阵(200/403/410/429);offer JSON 可 base64url 解码回读;节流计数与清零

## 4. WS 双凭据 gate + 连接生命周期(conn.rs)

- [ ] 4.1 `/ws` 握手:`?token=`(浏览器,现状零回退)或 `?device=&token=`(设备);两路产出 `ConnScope::{Browser, AppDevice{device_id}}`
- [ ] 4.2 设备凭据未授权/被撤:升级后立即 4001 close + reason(`unapproved`/`revoked`);壳据此分流
- [ ] 4.3 连接存活期 5s 复查 approved,翻 false 即 4001;AppDevice socket 按 device_id 计数(state.rs 增 in-memory 计数,设备行 live 点与 remote_control_active 共用)
- [ ] 4.4 hello 帧补 `capabilities: []`;连接泵与复查逻辑抽 `conn.rs`(server.rs 守 300 铁则,只留路由/握手/静态面)
- [ ] 4.5 单测:浏览器 token 零回退;设备 4001 两 reason;复查翻false断连;hello 含 capabilities 字段

## 5. dispatch scope 两档

- [ ] 5.1 `dispatch()` 与各域 `try_dispatch` 增 `&ConnScope` 形参;每命令一行注释标域归属
- [ ] 5.2 AppDevice 允许:dispatch_session(列表/回放/活流/发送/审批应答;**拒 session_spawn**)、fs/git 只读命令、misc 域 settings/workspaces/quota/platform 读;拒:全部写命令、dispatch_ssh 全域、sqliteQuery/插件市场/updater/config_write_*
- [ ] 5.3 单测拒绝矩阵:AppDevice 写命令/ssh/spawn 拒、读命令通;Browser 全量零回退

## 6. 桌面命令面(lib.rs 登记,dispatch 排除)

- [ ] 6.1 `web_pair_offer() -> {url,pairCode,expiresAt}`、`web_devices_list() -> {pending,approved}`(wire 不含 tokenHash)、`web_device_approve(deviceId)`、`web_device_revoke(deviceId)`(撤销即踢该设备 socket)
- [ ] 6.2 设备表变更发 `web://devices` 事件;四条命令 lib.rs invoke_handler 登记,web dispatch 显式排除并注释(同 web_access_start/stop 先例)
- [ ] 6.3 `src/kernel/ipc.ts` 补四条命令 wrapper 与 DeviceWire 类型

## 7. transport.ts 远程模式(唯一 kernel 改动点)

- [ ] 7.1 `configureRemoteEndpoint({wsUrl,deviceId,token} | null)`:置位后 invoke/listen 走 WebBridge 连远端(wsUrl + `?device=&token=`);浏览器态 location.host + webToken 原样;`isRemote` export
- [ ] 7.2 hello 增存 capabilities:`serverCapabilities()` 与 serverVersion 并列;onclose 读 code,4001 → 停止重连 + revoked 态 + 事件通知(壳清凭证回配对屏)
- [ ] 7.3 现有浏览器桩目检链路回归(transport 双态不破坏 isWeb 行为)

## 8. 桌面配对 UI(web-access 插件)

- [ ] 8.1 新 `src/plugins/web-access/WebDevicePairCard.tsx`(原型 ① 同构):添加设备 → QRCodeSVG(现有依赖)+ 配对码 chip + TTL 倒计时;待授权行(授权/忽略);已授权列表(live 点/上次活跃/踢除);订阅 `web://devices`;`web://pair-alert` 节流告警 toast
- [ ] 8.2 `WebAccessSection` 内网卡下挂载配对卡;isWeb 态隐藏(desktop-only)
- [ ] 8.3 i18n 三语词条(en/ja 落 kernel locales misc.ts web-access 段先例)
- [ ] 8.4 桩目检:配对卡全交互链(出码→pending→授权→踢除)

## 9. 协议层客户端脚本

- [ ] 9.1 `scripts/web-bridge-client.mjs`(Node 22+ global WebSocket):`--url --pair-code --device-name` → POST /pair → 轮询等授权 → WS(device 凭据)→ hello → invoke session_list → 事件 → attach 回放演示;`--token` 浏览器路径;`--expect-revoke` 断言撤销 4001
- [ ] 9.2 LAN 真桥跑通全链 = 协议验收判据(server bug vs UI bug 归因)

## 10. mobile-app/ 壳工程

- [ ] 10.1 `mobile-app/package.json` + `mobile-app/src-tauri/`(Cargo 仅 tauri,Rust 零本地命令);tauri.conf.json:frontendDist 指 repo 根 dist、devUrl 1421、bundle id/签名团队配置
- [ ] 10.2 壳标记注入 `window.__TMD_SHELL__`(initialization_script 或 userAgent 后缀,按 v2 API 定)
- [ ] 10.3 `pnpm tauri ios init` 出 Xcode 工程;`pnpm tauri ios build` 真机可装(模拟器先行)

## 11. 壳配对屏 + block 屏

- [ ] 11.1 `src/app-shell/mobilePairing.tsx`:粘贴 `tmd://pair` 链接自动解析 / 手输主机+配对码;LAN/relay 双端点竞速 POST /pair(lan 2s 超时切 relay)
- [ ] 11.2 `src/main.tsx` 守卫(≤10 行):有 `__TMD_SHELL__` 且无凭证 → 渲染配对屏;有凭证 → configureRemoteEndpoint(读 localStorage)+ 正常装配;桌面零影响(无标记 = 现状)
- [ ] 11.3 配对成功 → 试连 WS:4001-unapproved → 「等待桌面授权」5s 重试;hello 到达 → 存凭证 localStorage → 进远程模式;4001-revoked/撤销 → 清凭证回配对屏
- [ ] 11.4 hello.version/capabilities 不满足壳最低要求 → block 屏(当前版本/要求版本/重试按钮;注水 version 可演练)
- [ ] 11.5 [尝试] tauri 社区 barcode 扫码插件;不顺利降级 M2(粘贴兜底保留)

## 12. 验证收口

- [ ] 12.1 门禁:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`;`cargo test && cargo clippy --all-targets -- -D warnings && cargo fmt --check`
- [ ] 12.2 协议脚本 e2e:LAN 与 relay 两路 配对→授权→连接→invoke→事件→回放→撤销 4001
- [ ] 12.3 桌面真窗口目检:配对卡 QR/TTL/pending/授权/踢除/节流告警
- [ ] 12.4 真机 iOS e2e:粘贴配对 → 桌面授权 → 远程 home 会话列表 → 打开会话实况;LAN/relay 各验;撤销回配对屏;block 屏注水演练
- [ ] 12.5 `npx react-doctor@latest -y` 100 收口

## 13. 文档沉淀

- [ ] 13.1 spec 2026-09-21-mobile-app-design.md 补 M1 实施对照(本提案链接 + 偏离记录:localStorage 凭证/spawn 排除/扫码降级)
- [ ] 13.2 architecture/12-web-remote-access.md 增补:hello capabilities、双凭据 gate、dispatch scope、loopback 双绑(M3 定稿前先行记录)
- [ ] 13.3 本目录归档 openspec/changes/archive/(随 M1 收口提交)

## 明确不做(M1)

移动断点 UI 打磨 / RemoteHostBar / 本地通知 / 凭证 app-data+钥匙串 / 徽标设备名 hover / 相机扫码保底外投入 / E2EE / 终端键盘输入 / session_spawn 开放 / Android 壳。
