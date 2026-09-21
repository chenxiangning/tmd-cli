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
|配对协议|`web/pair.rs`:offer = base64url(`{v,hostId,name,pairCode,lan?,relay?}`)→ `tmd://pair?c=…`;`POST /pair {pairCode,deviceName}` → 200 `{deviceId,deviceToken,hostId,name,version}` / 403 错码 / 410 过期 / 429 节流。pairCode 即凭据(无 URL token 闸);8 位 `XXXX-XXXX`(gate 字母表)10min TTL 单次消费;按来源 IP 连续错码 5 次 → 429 + `web://pair-alert` 事件,成功清零。debug 构建起桥时 stderr 打 dev offer(release 不编译)。|
|WS 双凭据|`web/ws.rs`:`?token=`(浏览器,现状零回退)或 `?device=&token=`(设备,哈希比对+已批准);pending/被撤照常升级后立即 `4001` close(reason `pending`/`rejected`),壳据此分流;设备连接 5s 复查批准态 + 撤销即时踢(conn.rs LiveGuard watch,先发 Close 帧再收线防 1006)。hello 帧增 `capabilities:["browser"|"app-device"]`。|
|命令域|`web/conn.rs`:`dispatch_scoped` 包一层域闸(不改 dispatch 签名,域文件零改动)。AppDevice 白名单默认拒绝:session 域(列表/回放/活流/发送/resize;**拒 session_spawn/session_kill**)、fs-git 只读白名单、config/quota 只读;写命令/ssh/sqlite/wsl/lsp/plugins/checkpoint/web 管理面全拒。浏览器 scope 全量零回退。|
|壳配对门|`src/app-shell/mobilePairing.tsx`:`__TMD_SHELL__=mobile`(壳 initialization_script 注入)接管根装配;凭证存壳 webview localStorage `tmd.mobile.creds.v1`;连接门 4s 轮询授权、hello 版本不足(≥0.3.0)block 屏、rejected 清凭证回配对屏。transport 增 `configureRemoteEndpoint`/`isRemote`/`onRemoteRevoked(reason)`/`serverCapabilities`,远程模式下 invoke/listen 一律走桥连桌面,壳 Rust 侧零业务命令。|
