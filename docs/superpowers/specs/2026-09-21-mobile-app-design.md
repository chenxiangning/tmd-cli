# mobile app(Tauri 2 壳 · 轻交互 · 配对不加密)设计

> 日期:2026-09-21 · 状态:已评审通过(设计对话拍板:Tauri 2 壳 / 轻交互 / 配对+设备表不加密)
> 前置调研:`docs/research/orca-mobile-reference.md`(orca mobile 源码级分析)、`docs/research/mobile-remote-access.md`(通道选型)、`docs/research/codemoss-web-remote.md`(web-access 现状的移植出处)

## 背景与目标

tmd-cli 的 web-access 插件已把「手机浏览器访问桌面会话」打通(LAN axum 桥 + Cloudflare relay 出站中继 + 前端 isWeb 双态),但只有浏览器一种表面:无原生壳、无持久凭证(一次性 URL token 每次启动重生)、不可按设备吊销。目标是为 tmd-cli 添加 mobile app:

- **壳**:Tauri 2 iOS(先行;Android 同构后补),复用整份 React 前端,transport 切远程模式指向桌面。
- **功能面(v1)**:轻交互——看会话列表/终端实况、composer 发送、审批点选;不做终端键盘输入。
- **安全(v1)**:QR 配对 + 每设备独立可吊销 token + 设备表;不做 E2EE,协议预留升级位。

## 方案取舍

| 维度 | 选定 | 被否决 | 理由 |
|---|---|---|---|
| 壳形态 | Tauri 2 壳复用整份前端 | Expo RN 原生配套 app(orca 同款) | RN 栈近 500 个 ts 文件且与现有前端零复用;orca 的移动体验上限(原生聊天/语音/推送)对 tmd-cli 非当前需求;Tauri 2 壳薄,插件语义全保留 |
| 壳形态 | Tauri 2 壳复用整份前端 | PWA 先行 | 手机浏览器已能用,PWA 无原生凭证存储/图标/未来推送位;作为壳的替代不成立,浏览器态本身继续保留即天然覆盖 PWA 价值 |
| 功能面 | 轻交互(看 + 发 + 审批) | 全控(含终端键盘输入) | xterm.js 触摸短板(官方承认)直接暴露;全控需 driver/presence-lock 仲裁(学 orca presence-lock),复杂度大;轻交互只读不抢 PTY,风险面砍半 |
| 功能面 | 轻交互起步 | 分阶段承诺 v1.5 全控 | 终端输入延后但明确为升级方向;RPC 域划分(v1)就按可扩展设计,届时只增终端写域 + driver 仲裁 |
| 安全档 | 配对 + 设备表,不加密 | 配对 + E2EE(orca 全套) | E2EE 需 Rust + JS 双侧加密实现与密钥治理,个人自用 + 自部署 Worker + TLS 场景收益递减;hello capability 预留使 E2EE 可后补不破协议 |
| 安全档 | 配对 + 设备表 | 维持一次性 URL token | token 每次启动重生 → app 凭证反复失效;不可单独吊销某台设备;设备表是 app 形态的最低身份要求 |
| hostId | 16 字节随机稳定 ID | 真 Curve25519 公钥(orca) | v1 无 E2EE,公钥 pin 无加密语义可承载;随机 ID 同样满足「endpoint 是否还是这台桌面」的识别;E2EE 落地时同字段换公钥,schema v 号管升级;不为不用的加密铸钥匙 |
| 设备表存储 | tokenHash(sha-256) | 明文 token(orca orca-devices.json) | 存 hash 后文件泄露不泄露可用凭证,成本一行 |
| 服务面 | dispatch 加 scope 两档(app 设备走裁剪域,浏览器 token 维持全量) | 全量镜像不动 / orca 式逐命令 allowlist | 全量不动则手机 app 持久凭证握着 RCE 级命令面;逐命令枚举对 tmd-cli 原语面过重;浏览器 token 行为零回退 |
| 通知 | 本地通知(前台/短暂后台) | APNs/FCM 推送后端 | Tauri 2 无官方 push 插件,APNs 需后端;relay Worker 加推送通道是明确 v2 升级路径 |
| 多路径 | LAN / relay 二选一 + 手动切换 | orca stable-logical-rpc-client 热迁移 | 迁移窗口订阅重放复杂度高;真实断线痛了再上(YAGNI);磁盘先行回放已把重连代价压低 |
| 开发基建 | 协议层最小客户端脚本 + 现有浏览器桩 | golden 回放体系 / mock server | 桌面真桥 + 桩配方已覆盖开发回路;golden 787 个的录制纪律是 orca 规模才需要的投入 |

## 方案

### A. 身份与配对(桌面侧,`src-tauri/src/web/`)

1. **hostId**:首次配对时生成 16 字节随机 ID 存 app-data(`web_host_id`),一次性;QR 内嵌,手机侧用于识别桌面身份。
2. **设备表** `web_devices.json`(app-data,0600):`{deviceId, name, tokenHash, createdAt, lastSeenAt, approved}`;新文件 `web/devices.rs`(设备注册表 + 配对码生命周期,预估 ~200 行,遵守 300 行铁则)。
3. **配对流**:
   - web-access 设置卡「添加设备」→ 铸 8 位配对码(10 分钟 TTL,单次消费)→ 屏显 QR:`tmd://pair?c=` + base64url(JSON `{v:1, hostId, name, pairCode, lan?, relay?}`)。
   - 手机扫码 → `POST /pair`(带 pairCode + deviceName)→ 校验通过落 pending 设备行 → 返回 `{deviceId, deviceToken}`。
   - 桌面设置页待授权列表 → 用户点「授权」翻 approved。
   - 此后 WS 以 `?device=<id>&token=<t>` 连接;gate 双凭据并列(配对设备 hash 比对 / 现有一 LAN 一次性 URL token 原样保留);approve/revoke 仅桌面;撤销即断连;未授权/被撤 4001 + 节流提示(学 orca UnpairedDeviceAuthThrottle:连续失败触发桌面 UI 信号)。
4. **协议门控**:hello 帧补 `capabilities: []`;壳侧 min-version 检查 → React block 屏(指向更新);E2EE 升级位 = capability 字符串。

### B. 服务面按域裁剪

`web/dispatch.rs` 加 scope 维度:配对设备(app 通道)命中 remote-allowed 域——session(列表/回放/活流/发送/审批)+ 只读 fs/git + 设置读;浏览器一次性 token 维持全量(现状零回退)。每命令一行标注归属域,不做逐命令枚举表。

### C. 手机壳(`mobile-app/`,Tauri 2)

- 独立薄壳工程:内嵌同一份前端 dist;Rust 侧零本地命令。
- boot:读配对凭证(先 app-data 文件;iOS 钥匙串经社区 plugin 后补,spec 注明取舍:先最小可用,凭证敏感度=设备表同档)→ 无凭证进配对屏(扫码)→ 有凭证进远程模式。
- `src/kernel/transport.ts` 参数化 endpoint:现硬编码 `location.host`,远程态注入 lan/relay URL + device 凭据;桌面 webview 与浏览器 isWeb 态零改;`ipc.ts` 零感知(唯一前端 kernel 改动点)。
- 会话打开 = architecture/06 磁盘先行回放 + 活流接管,手机与桌面同构,零新增协议。
- UI:移动断点(侧栏折叠、composer/审批线自适应)+ RemoteHostBar(主机名/连接态/重试);终端只读渲染,无键盘工具条。

### D. 通知(v1)

tauri-plugin-notification 本地通知:WS 事件(审批请求/会话完成)在 app 前台或短暂后台时弹本地通知;断连期无推送(明确接受,APNs 后端为 v2)。

### E. 基建与验证

- `scripts/web-bridge-client.mjs`:裸 WS 协议层客户端(invoke/事件/attach 回放),学 orca `test-subscribe.ts`——协议层归因(server bug vs UI bug)判据,CI 可跑。
- 验证清单见下节。

## 验证

- 门禁:前端 `pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`;Rust(桌面)`cargo test && cargo clippy --all-targets -- -D warnings && cargo fmt --check`(src-tauri/ 下);提交收口 `npx react-doctor@latest -y` 得分 100。
- 协议层:`scripts/web-bridge-client.mjs` 对真桥跑通 配对 → 连接 → invoke → 事件 → attach 回放;撤销后旧 token 4001 断连。
- 真机(iOS):`pnpm tauri ios build` 安装实机;目检场景:扫码配对 → 桌面授权 → 进远程模式;LAN 与 relay 两路各验;会话列表/磁盘回放/活流旁观/composer 发送/审批;断连重连(切蜂窝/回前台)回放接管;桌面撤销设备 → app 即时掉线;block 屏(min-version 注水演练)。
- UI 行为改动以 `pnpm tauri:dev` 真窗口目检桌面侧(配对卡/设备管理/远程徽标)。

## 明确不做(v1)

E2EE(capability 预留)/ 终端键盘输入与 driver 仲裁(v1.5,蓝本 = orca presence-lock + reclaimTerminalForDesktop)/ APNs/FCM 推送后端 / stable-logical 多路径热迁移 / golden 回放体系 / mock server。
