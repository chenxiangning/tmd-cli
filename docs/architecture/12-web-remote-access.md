# 12 — Web 远程访问桥(M1 LAN + M2 外网中继)

日期:2026-09-17 | 状态:已落地(18 笔提交整体 review 后收口,本文同时沉淀契约与 review 决策)

## 背景与目标

手机/平板浏览器远程驾驶本机会话。两段交付:M1 = LAN 直连(同一 Wi-Fi);M2 = 外网中继(桌面出站拨 Cloudflare Worker,无端口映射)。调研与提案见 `openspec/changes/2026-09-15-web-remote-access/` 与 `docs/research/mobile-remote-access.md`。

## 契约

|面|契约|
|---|---|
|传输层|`src/kernel/transport.ts` 继承 R3(ipc.ts 的全部 `@tauri-apps/*` import 集中于此):webview 态原样透传;浏览器态走 WS(重连退避 1s→10s 封顶、open 20s 超时、pending 释放、hello 版本握手)。前端 ipc 层对运行环境零感知。check-arch-boundary R3 白名单同步。|
|事件扇出|`src-tauri/src/event_sink.rs`:桌面 webview(emit)+ 桥总线(broadcast,容量 512,慢消费者跳帧不反压桌面)双扇出;pty 泵「emit 失败即退出」契约不变。|
|命令镜像|`src-tauri/src/web/dispatch.rs` 镜像 invoke_handler 全量命令(新增宿主命令必须同步登记,与 lib.rs 同纪律);面控命令(web_access/relay start-stop、relay_deploy、app_restart、updater 族)排除在镜像外,EXCLUDED 清单有测试。`config_write_settings` 落盘成功后广播 `settings:changed`(与 relay 直写盘同款纪律,防跨面静默回滚)。|
|信任模型|**token 持有者 = 桌面等权**(dispatch 可达 fs/pty/sqlite/install 全量),风险弹窗如实告知。token 24 字符 CSPRNG,gate.rs 双侧 SipHash 后 u64 定长比较;每次起服务重铸(重启后旧链接 403,需重新扫码)。风险弹窗只承诺真实存在的机制:密钥即凭据/不转发/用完断开/重启重铸 —— 无设备管理面,不虚诺 per-device approval。|
|停机语义|`watch::Sender<bool>` 广播:accept 循环 + 每连接 reader/writer。**select! 的 else 分支只在全分支 pattern 被禁用时执行**(治不了「stop 早于订阅」);订阅后必须立即 `borrow_and_update()` 吸收已置位,否则 socket 带完整派发权活到自行断连(2026-09-17 review P2 修复)。|
|/file 范围|$HOME 内;**首段 dot 条目默认拒绝**(凭据/历史/OAuth 全在内),白名单仅 `.tmd-cli/wallpapers`;非 dot 维持放行(工作区预览)。canonicalize + $HOME 前缀校验防 symlink 逃逸;先验大小再读。黑名单枚举追不完新 CLI 凭据落点,允许制一刀切更稳(review P2 改造)。|
|LAN 绑定|只绑 `lan_ip()` 解析出的接口 IP(与展示 URL 同源;解析失败回落 127.0.0.1),VPN tun/容器网段不随 0.0.0.0 全接口可达(review P2 改造);stderr 日志不打含 token 的完整 URL。|
|中继链路|桌面出站 WS 拨 Worker `/agent?key=`(key 32×27 字母表 ≈151bit);Worker 无策略转发,真正门禁仍在桥 gate token;DO 一 key 一实例防自交错;心跳 15s×2 判死。一键部署(CF API Token 仅内存直传,不落盘不进日志)与导出包产物同源(WORKER_SOURCE 与 zip 内 index.js 同字节)。**部署 ≠ 同意连接**:`webRelayOn` 只由 Rust 侧 start/stop 成功后落盘,部署卡只回填 url/key(review P2 修复:防 autostart 静默拨通外网)。|
|设置面|`webAccessEnabled`/`webRelay*` 字段 sanitize 严格类型截断,旧盘文件向后兼容;桥生命周期归桌面端(web 面只落盘不起停桥);autostart 读盘自启。|

## 方案取舍

- **token 每次起服务重铸 vs 持久固定**:选重铸——泄露窗口有限,代价是重启后需重新扫码;「加到主屏幕当 app」的体验损失记为已知取舍。
- **绑 lan_ip vs 0.0.0.0**:选 lan_ip(与展示 URL 同源);DHCP 换 IP 后桥需重启重绑,可接受(桥本就低频常驻)。
- **/file 允许制 vs 黑名单**:选允许制——新 CLI 凭据落点(.claude/.codex/.local…)追不完,枚举黑名单是维护负债。
- **中继每帧 b64+JSON(~1.78× 膨胀)vs 二进制帧**:维持文本帧对齐 codemoss,终端量级可接受;大文件传输再上二进制帧(review 留档)。
- **file-size-exempt 豁免**:web 域 6 个 Rust 文件(relay/dispatch 等)按「同源移植/命令面镜像总表,拆分即伤对照性」豁免;check-file-size.mjs 注释已承认该豁免类。

## 验证

18 笔提交整体 review(4 域并行)后收口:`cargo test && cargo clippy -D warnings && cargo fmt --check` + `pnpm typecheck && test && check:arch-boundary && check:file-size && build` + react-doctor 100;review 修复(P1 relaunch 插件恢复、P2×7)逐条落地,修复明细见本表内联注记。

## 配对底座增补(M1 mobile-app,2026-09-22 落地)

实施提案:`openspec/changes/2026-09-21-mobile-app-m1-pairing/`;壳工程 `mobile-app/`(bundle id `com.tmdcli.mobile`)。

|面|契约|
|---|---|
|LAN 双绑|`web/bind.rs`:绑 `lan_ip:0` 后以同端口号补绑 `127.0.0.1` 第二 listener(桥本身落 loopback 则免)。relay_agent 每流转成都对 `127.0.0.1:{port}` 回拨,单绑 LAN IP 会拒 —— d227f8c 收窄绑定后 relay 数据面整体断的本修复;停机信号 oneshot→watch 转发,双 serve 同收。|
|设备注册表|`web/devices.rs`:`~/.tmd-cli/web_devices.json`(0600,原子写),行含 `tokenHash`(sha-256,明文 token 只在 /pair 应答出现一次);hostId:`~/.tmd-cli/web_host_id` 一次性 16B hex。配对码与节流计数为进程内存态(桌面重启即失效)。|
|配对协议|`web/pair.rs`:offer = base64url(`{v,hostId,name,pairCode,lan?,relay?}`)→ `tmd://pair?c=…`;`POST /pair {pairCode,deviceName}` → 200 `{deviceId,deviceToken,hostId,name,version}` / 403 错码 / 410 过期 / 429 节流。pairCode 即凭据(无 URL token 闸);8 位 `XXXX-XXXX`(gate 字母表)10min TTL 单次消费;按来源 IP 连续错码 5 次 → 429 + `web://pair-alert` 事件,成功清零。/pair 响应带 CORS 三头 + OPTIONS 预检(壳 origin `app://tmd` 跨域;node 脚本不受 CORS 管,e2e 掩盖过此缺口)。debug 构建起桥时 stderr 打 dev offer(release 不编译)。|
|WS 双凭据|`web/ws.rs`:`?token=`(浏览器,现状零回退)或 `?device=&token=`(设备,哈希比对+已批准);pending/被撤照常升级后立即 `4001` close(reason `pending`/`rejected`),壳据此分流;设备连接 5s 复查批准态 + 撤销即时踢(conn.rs LiveGuard watch,先发 Close 帧再收线防 1006)。hello 帧增 `capabilities:["browser"|"app-device"]`。|
|命令域|`web/conn.rs`:`dispatch_scoped` 包一层域闸(不改 dispatch 签名,域文件零改动)。AppDevice 白名单默认拒绝:session 域(列表/回放/活流/发送/resize;**拒 session_spawn/session_kill**)、fs-git 只读白名单、config/quota 只读、checkpoint 只读二令(`checkpoint_list`/`checkpoint_batch_diff`,M2 审批线摘要;写/回退/批准全拒);写命令/ssh/sqlite/wsl/lsp/plugins/web 管理面全拒。浏览器 scope 全量零回退。协议脚本 `web-bridge-client.mjs` 对扩面白名单回归(读令过闸 + 写令域拒)。|
|壳配对门|`src/app-shell/mobilePairing.tsx`:`__TMD_SHELL__=mobile`(壳注入脚本)接管根装配;凭证经 `mobileCreds.ts`:壳态钥匙串优先(`shell.creds.*`)+ localStorage 旧值一次性迁移 + 内存缓存(loadCreds 同步消费),浏览器态维持 localStorage;连接门 4s 轮询授权、hello `capabilities` 缺 `app-device` → block 屏(协议能力判定,非版本阈值)、rejected 清凭证回配对屏。transport 增 `configureRemoteEndpoint`/`isRemote`/`onRemoteRevoked(reason)`/`serverCapabilities`/`serverVersion`/`isRemoteConnected`+`onRemoteConnection`/`forceRemoteReconnect`(桥实现拆 `transportBridge.ts`),远程模式下 invoke/listen 一律走桥连桌面,壳 Rust 侧零业务命令。|
|壳形态(实测定)|原生 SwiftUI + WKWebView(`mobile-app/native-shell/`,xcodegen 生成工程,`scripts/build-device.sh` 一键出包),**非 Tauri 壳**:上游 tauri-cli 的 iOS 流水线在 Xcode 27 下不可用(xcode-script 守护进程 panic;SPM shim 符号/平台错配;手写 scene manifest 与 tao 冲突 segfault)。壳三职责:WKURLSchemeHandler 以 `app://tmd/` 为根服务内嵌 dist(绝对路径产物不能用 file://)、注入 `__TMD_SHELL__`、AVCapture 扫码桥(`window.__TMD_QR__`)。bundle id `com.tmdcli.mobile`。|
|移动断点|`useIsNarrow`(≤768):单栏 MainPanel + `NarrowDrawer` 左栏抽屉(遮罩 button/Escape 收起,会话激活联动自动收)+ `RemoteHostBar`(主机名/连接态/重试);桌面专属栏(文件预览/右文件面板)窄屏隐藏。桌面三栏拆 `DesktopColumns`(行为不变)。|

## 轻交互闭环增补(M2 mobile-app,2026-09-22 落地)

|面|契约|
|---|---|
|壳能力桥|`src/kernel/shellBridge.ts` ↔ Swift `ShellBridge`(`mobile-app/native-shell/ShellBridge.swift`):帧 `{id,method,args}` postMessage → `window.__TMD_SHELL_RESULT__(id,ok,payload)` 回注;能力 `notify`(UNUserNotificationCenter,权限拒静默 ok)/ `creds.get/set/delete`(Keychain GenericPassword,AfterFirstUnlockThisDeviceOnly)。**手机本机能力,不经桌面桥、不进 AppDevice 白名单**;非壳环境 `hasShellBridge()=false`,调用方降级。|
|双通道竞速|凭证 `urls: string[]`(配对 offer 全端点);连接序 = `endpointCandidates`(钉选优先,auto 按 urls 序)逐个 `connectOne`(8s 超时换下一端点;pending/rejected 端点无关即返);钉选存 localStorage `tmd.mobile.channel.v1`,RemoteHostBar 菜单切换即重臂。旧凭证无 urls → 单 wsUrl 兼容。|
|运行期撤销|`onRemoteRevoked` 回调**不清空**(常驻订阅跨多次逐出存活;bye+4001 双触发由消费方幂等吸收);`mountMobileShellGate` 注册常驻处理器:非 pending 逐出 → 清凭证 + reload 回配对屏(主应用挂载后 gate 已退订,B2 修复)。|
|回前台重拨|`pageshow`/`visibilitychange` → `forceRemoteReconnect()`(iOS 后台掐 WS;退避最长 10s 不可等;closed/未配对 no-op)。|
|审批浮标与通知|`AskMobile.tsx`:`AskFloatingBadge`(窄屏等待计数浮标 → 列表 → setActiveSession 直达幕布;应答 = 幕布软键盘按键,不自造代发键——各 CLI 键位语义不一);`AskNotifier` 边沿通知:进入等待(冷启动首轮只记基线防风暴)+ `turnSettled.unviewed` → `shellNotify`。|
|审批线窄屏摘要|checkpoints 插件 `contribute("overlay")` → `CheckpointsMobileSummary`(批次只读清单 + 待审计数;刷新链仅窄屏启用防桌面双份轮询;写操作无入口)。|
|软键盘避让|`useViewportHeight` → `--tmd-vvh`(visualViewport 高度),窄屏壳根 height 消费(iOS 100vh 不随键盘缩)。|
