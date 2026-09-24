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
|中继链路|桌面出站 WS 拨 Worker `/agent?key=`(key 32×27 字母表 ≈151bit);Worker 无策略转发,真正门禁仍在桥 gate token;DO 一 key 一实例防自交错;心跳 15s×2 判死。一键部署(CF API Token 仅内存直传,不落盘不进日志)与导出包产物同源(WORKER_SOURCE 与 zip 内 index.js 同字节)。**部署 ≠ 同意连接**:`webRelayOn` 只由 Rust 侧 start/stop 成功后落盘,部署卡只回填 url/key(review P2 修复:防 autostart 静默拨通外网)。拨号不走 `connect_async`(它不读 `*_PROXY` env,直连被墙时=整 20s 超时):`relay_agent::dial_agent` 按进程 env 代理(HTTP(S)_PROXY/ALL_PROXY/NO_PROXY,复用 ssh CONNECT/SOCKS5 握手)先打通 TCP 再升 TLS+WS;rustls 树内 ring+aws-lc-rs 双 provider 歧义 panic,拨号前显式装 aws-lc-rs(与 reqwest 一致)。|
|自建服务器落点|中继第二落点(2026-09-24,spec 2026-09-24-selfhost-relay-deploy-design):用户自有公网服务器跑 `deploy/relay/tmd-relay-server.mjs`(与 Worker 同线协议;80 明文 + 443 真 TLS 双监听)。存在理由 = 国内蜂窝运营商 DPI:明文 WS upgrade 在所有端口被间歇吞(workers.dev 还被墙),唯一稳解是 443+TLS。一键部署 `relay_deploy_selfhost`:复用 ssh 引擎(russh 一次性 exec,文件走 exec+stdin 免 base64)→ 桌面 rcgen 现场铸 SAN=IP 十年自签(私钥不出桌面)→ 上传 mjs/env/cert/key → systemd enable --now → 服务器本机 healthz 自检;成功 Rust 一次写 settings(webRelayUrl/Key/CertHost/CertDer),凭据仅本次调用。手动兜底 `relay_selfhost_pack`(zip 烧好证书/key,README 三条命令与 UI 逐字一致)。|
|证书钉住(动态)|不信任公共 CA:`pinned_tls.rs` 钉住表 = 内置 ECS 一张(编译期 DER)+ settings 动态一张(webRelayCertHost/Der,一键部署或导包落盘),仅命中 host 才钉、其余主机走 webpki-roots。配对 offer 带 `pin`(base64 SHA-256,仅 https 中继且 host 命中动态钉时),手机存进钥匙串 creds.pin/pinHost,壳 `PinnedTLS.swift` 内置指纹失败后查 creds 回落——换服务器 = 重新扫码,免重装 app。/pair 走壳原生 URLSession(WKWebView fetch 必拒自签)。|
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
|命令域|`web/conn.rs`:`dispatch_scoped` 包一层域闸(不改 dispatch 签名,域文件零改动)。AppDevice 白名单默认拒绝:session 域(列表/回放/活流/发送/resize/spawn/pin_toggle;**拒 session_kill/session_bind_cli**——bind_cli 唯一调用方是桌面镜像回写走 webview 通道,设备域放行 = 张冠李戴任意磁盘身份)、fs-git 只读白名单、config/quota 只读、checkpoint 只读二令(`checkpoint_list`/`checkpoint_batch_diff`,M2 审批线摘要;写/回退/批准全拒);写命令/ssh/sqlite/wsl/lsp/plugins/web 管理面全拒。域闸三面收口(红队 2026-09-24):`config_read_settings` 设备域返回值剥密钥字段(key/token/secret/password/webRelayUrl 命名一刀切;整树裸回 = webRelayKey 泄露 → 中继 agent 劫持,撤销设备不失效);`session_spawn` 设备域 spec.env 剥离(PATH/DYLD 注入)+ spec.cwd 限已注册工作区根(canonicalize 双侧);订阅帧过 `event_allowed`(pty://* + settings:changed,ssh:// / lsp:// / web://* 静默拒 + 256 上限,命令域闸在事件面的镜像;拒绝回 subscribe-rejected 帧清客户端乐观位)。spawn 引擎白名单收桌面权威命令名(qoder = qodercli/qoderclicn,漂移即秒退,回归测试钉死;shell 四件套 bash/zsh/sh/fish 退闸 2026-09-24——手机引擎表无 shell 入口、桌面内置终端走 webview 不过本闸,纯攻击面)。
|信任边界定夺(2026-09-24,专业收口)|①设备 fs_read_file 保持全盘读不收:手机历史屏/续聊数据面 = dot 目录里的会话 jsonl/logptr(~/.claude/projects、~/.pi/agent/sessions 等),套 file.rs dot 黑名单 = 打断核心功能;且设备已持 session_write(可向任意在跑会话注入),读面收紧是假安全。②relay 手机浏览器链保持全量 browser scope 不裁:该链接跑 DesktopApp 全树,裁剪 = 砍「免安装浏览器远控」产品形态;泄露面已收 webToken replaceState 抹历史 + 起桥重铸,明文中继的正解是部署层上 TLS(wss),非代码。③批准设备 ≈ SSH 级信任为公理,红队链4「引擎旗标注入第二执行路径」在此模型内自洽接受。|`session_pin_toggle` = 置顶窄写令:服务端读改写**仅 sessionPins 一键**(手机不持全量 settings 快照,整树写会静默覆盖桌面并发修改),写后广播 `settings:changed` 全回读(手机也监听该事件重拉覆盖层,桌面侧改动即时同步)。浏览器 scope 全量零回退。协议脚本 `web-bridge-client.mjs` 对扩面白名单回归(读令过闸 + 写令域拒;pin_toggle 活体探测会写用户 settings.json,过闸断言归 conn.rs 单测)。|
|壳配对门|`src/mobile/gate.tsx`:`__TMD_SHELL__=mobile`(壳注入脚本)接管根装配;凭证经 `src/mobile/creds.ts`:壳态钥匙串优先(`shell.creds.*`)+ localStorage 旧值一次性迁移 + 内存缓存(loadCreds 同步消费),**所有壳往返 3.5s 看门狗**(老壳对新方法不应答 → 回落 localStorage 不迁移不丢凭证;永挂=整树白屏,2026-09-23 修复),浏览器态维持 localStorage;连接门 4s 轮询授权、hello `capabilities` 缺 `app-device` → block 屏(协议能力判定,非版本阈值)、rejected 清凭证回配对屏。transport 增 `configureRemoteEndpoint`/`isRemote`/`onRemoteRevoked(reason)`/`serverCapabilities`/`serverVersion`/`isRemoteConnected`+`onRemoteConnection`/`forceRemoteReconnect`(桥实现拆 `transportBridge.ts`),远程模式下 invoke/listen 一律走桥连桌面,壳 Rust 侧零业务命令。|
|壳形态(实测定)|原生 SwiftUI + WKWebView(`mobile-app/native-shell/`,xcodegen 生成工程,`scripts/build-device.sh` 一键出包:pnpm build → 拷 dist → xcodebuild 自动签名 M8Y933SMW6,`--install` 直装第一台连接真机;**壳二进制与 dist 必须同包**,只刷前端不重装壳 = 契约漂移白屏类 2026-09-23 实证),**非 Tauri 壳**:上游 tauri-cli 的 iOS 流水线在 Xcode 27 下不可用(xcode-script 守护进程 panic;SPM shim 符号/平台错配;手写 scene manifest 与 tao 冲突 segfault)。壳四职责:WKURLSchemeHandler 以 `app://tmd/` 为根服务内嵌 dist(绝对路径产物不能用 file://)、注入 `__TMD_SHELL__`、AVCapture 扫码桥(`window.__TMD_QR__`)、`shell` 桥 `log` 方法 = 页面诊断通道(发后即忘,写入沙箱 Documents/shell.log)。bundle id `com.tmdcli.mobile`。|
|移动断点|~~`useIsNarrow`/`NarrowDrawer`/`RemoteHostBar`~~(退役:手机改独立树 `src/mobile/`,桌面三栏 `DesktopColumns` 不变;死原语已删 2026-09-24)。|

## 轻交互闭环增补(M2 mobile-app,2026-09-22 落地)

|面|契约|
|---|---|
|壳能力桥|`src/kernel/shellBridge.ts` ↔ Swift `ShellBridge`(`mobile-app/native-shell/ShellBridge.swift`):帧 `{id,method,args}` postMessage → `window.__TMD_SHELL_RESULT__(id,ok,payload)` 回注;能力 `notify`(UNUserNotificationCenter,权限拒静默 ok)/ `creds.get/set/delete`(Keychain GenericPassword,AfterFirstUnlockThisDeviceOnly)。**手机本机能力,不经桌面桥、不进 AppDevice 白名单**;非壳环境 `hasShellBridge()=false`,调用方降级。|
|双通道竞速|凭证 `urls: string[]`(配对 offer 全端点);连接序 = `endpointCandidates`(钉选优先,auto 按 urls 序)逐个 `connectOne`(8s 超时换下一端点;pending/rejected 端点无关即返);钉选存 localStorage `tmd.mobile.channel.v1`,HostChip 端点 sheet 切换即重臂。旧凭证无 urls → 单 wsUrl 兼容。|
|运行期撤销|`onRemoteRevoked` 回调**不清空**(常驻订阅跨多次逐出存活;bye+4001 双触发由消费方幂等吸收);`mountMobileShellGate` 注册常驻处理器:非 pending 逐出 → 清凭证 + reload 回配对屏(主应用挂载后 gate 已退订,B2 修复)。|
|回前台重拨|`pageshow`/`visibilitychange` → `forceRemoteReconnect()`(iOS 后台掐 WS;退避最长 10s 不可等;closed/未配对 no-op)。|
|审批应答与通知|SessionScreen ask 卡(实况尾窗命中通用标记表 ASK_MARKER_RE → 卡上按键 = session_write 原始序列;写失败回滚弹卡)。**刻意子集**:不含 profile 私有 askMarks/1.2s 候选确认/写后 8s 抑制(桌面 askWatch 全量语义)。通知 = 卡首现 `notifyAsk` → `shellNotify`(AskMobile.tsx 浮标/边沿通知链已随紧凑化重构退役 2026-09-24)。|
|审批线窄屏摘要|checkpoints 插件 `contribute("overlay")` → `CheckpointsMobileSummary`(批次只读清单 + 待审计数;刷新链仅窄屏启用防桌面双份轮询;写操作无入口)。|
|软键盘避让|~~`useViewportHeight` → `--tmd-vvh`~~(退役:手机壳根改 `100dvh`,iOS 键盘自动缩;死钩子已删 2026-09-24)。|

## 手机独立树增补(会话屏紧凑化 + 实况滚动 + 历史续聊,2026-09-23 落地)

|面|契约|
|---|---|
|单顶栏|`src/mobile/ConnChip.tsx`:`HostChip`(连接点+主机名,点开 = 端点钉选/重试/重新配对 sheet)+ `ConnBanner`(断连告警不折叠);旧 HostBar 双条堆叠退役。审批线常驻行 → session nav 计数芯片 + `CkptSheet`(checkpoint_list/batch_diff 白名单二令只读)。|
|实况滚动|`LiveScreen`(src/mobile/liveText.ts)= 固定视口 VT 模型 + **scrollback(有界 2000 行)**:LF 触底上滚与清屏/备屏翻页都把旧行进历史,`view()` = scrollback+视口全量 → 实况区可向上滚动看全部输出;SessionScreen 自动滚底 = 跟随态(贴底 <48px)才拽底,上滚阅读不被新输出打断,展开实况块重进跟随。|
|键盘工具条|`KeyToolbar.tsx`:十键(esc/tab/⌃c/←→↑↓/↵/Pg↑↓)经 `session_write` 发原始 PTY 序列;切模型 = composer 发 `/model` 开 CLI TUI 后用键条操作(零新 RPC,十家 CLI 通吃);composer 聚焦时整行隐藏。|
|历史续聊|`src/mobile/resume.ts` + `engines.ts`(resume 参数镜像各插件 profile.resumeArgs):HistoryScreen「继续对话」= `session_spawn`(已在白名单)带 `--resume <cliSessionId>` + 工作区 cwd,与桌面 openDiskSession 同语义。**去重**:本连接期内存表 + 磁盘日志指针 `~/.tmd-cli/session/<slug>/<slug>/<cliId>.logptr`(fs_read_file 已放行)→ 指针 logId 仍在 session_list = 聚焦既有 PTY,绝不双开;指针缺/已死 = 冷开。手机自 spawn 走冷路径(桌面 acquireResume 预热池不在手机视野,M1 取舍)。|
|桥发起补装配|桥 `session_spawn` 绕过桌面前端生命周期(身份绑定/常驻订阅/状态守望全缺 → 桌面行短码标题+无运行态,续接老会话标题失联)。契约:`session_spawn` 可带 `cliSessionId`(注册表直填,`SessionMeta.cli_session_id` 经 session_list 出线上形状);桥成功后广播 `session:external-spawn` → 桌面 `host.adoptExternalSession` 单会话补装配(activate:false 不抢前台;`adoptInflight` 闸防发起端本地 adopt 双订阅)。桌面账本绑定唯一写入口 `bindIdentity` 同步镜像回写注册表(`session_bind_cli`),手机 session_list 直读 `cliSessionId` 解析标题/归档/置顶 key;readopt 按注册表视图回灌身份(webview 重载后账本丢桥绑身份)。|
|桥写补锚定|桥 `session_write` 直通 Rust PTY,桌面 `writeSession→onUserWrite` 锚定链(ActivityWatch 开轮/EditWatch/Ask 解除)被绕过 → 桌面行状态签全盲。契约:桥写成功广播 `session:remote-write{sessionId}` → 桌面 `noteRemoteWrite` 走同款守望扇出(synthetic=false;桌面自身写走 webview IPC 不过桥,无回声)。|
|home 顶区|`topZones`(history.ts):已置顶(settings.sessionPins 镜像,pinnedAt 升序)+ 运行中(全部活会话,新在上)两区常驻列表顶;行内 📌 钮切换置顶(无稳定磁盘身份的未绑定新活会话不渲染钮)。|
|home 平铺+归档分段|工作区组内会话行按时间平铺(引擎子分组头退役);组头下「本地/归档」分段 = 桌面 `settings.sessionArchive` 覆盖层只读镜像(`config_read_settings` 已放行,key `wsId:profileId:cliSessionId` 与 kernel/sessionArchive 同构;活行恒本地)。分页水位按 工作区:分段 独立。|
