# 外网中继拆分:Cloudflare 与自建服务器两种落点 + 一键 SSH 部署

日期:2026-09-24
状态:已落地(a58b9bc;桩目检四 tab + 全门禁绿;真机一键部署待对 ECS 重放验收)

## 背景与目标

现状:「Web 访问 → 外网」tab 把两种中继落点(一键部署 Cloudflare Worker / 导出包自行 wrangler deploy)混在一张部署卡里,而实际验证可用的路线是自建 ECS 中继(手工 SSH 部署,2026-09-24 凌晨人肉完成)。用户诉求:

1. 把「Cloudflare 中转」与「自建服务器」在设置页明确区分成两个 tab;
2. 自建服务器提供**一键部署**:桌面经 SSH 自动完成上传、systemd 安装、健康自检;
3. 附手动部署指导(一键失败时的兜底)。

硬约束(血泪结论,见 MEMORY「外网中继最终可用形态」):手机蜂窝网 DPI 对所有端口的明文 WebSocket Upgrade 间歇丢弃,**自建落点必须 443 + 真 TLS**;证书为桌面现场生成的自签证书(SAN=目标 IP),双端证书钉住。

## 方案取舍

**选定:tab 三分 + 全自动 SSH 部署 + 动态证书钉住。**
- tab 结构:`内网 | Cloudflare | 自建服务器 | 设备`。连接卡(`WebRelayCard`)两 tab 共用(同一时刻只挂载一个 pane,无状态冲突)。
- 部署引擎留在 web-access 插件的 Rust 侧(`src-tauri/src/web/relay_selfhost*.rs`),复用 `ssh::transport::connect_ssh_handle`(含代理/认证栈)与 russh 一次性 exec 通道;不抽通用 kernel SSH 部署能力——单插件语义不入 kernel(架构铁律)。
- 证书从「编译期钉死一张 DER」改为**部署时现场铸 + 运行期动态钉**:桌面用 rcgen 生成 SAN=IP 自签证书(十年),DER+key 随部署落盘服务器,指纹写进 settings;桌面 `pinned_tls` 优先用 settings 的 DER、回落内置;配对 offer 带指纹,手机存进 creds,`PinnedTLS` 查表。**换服务器 = 重新扫码,不重装 app。**

**否决 A:仅指导 + 导出包(零 Rust)。** 用户明确选全自动;指导包保留为兜底折叠区而非主路径。
**否决 B:复用交互式 SSH 会话(PTY)跑部署脚本。** 部署是机器驱动的一次性 exec,PTY 解析噪声大、无退出码契约;russh exec 通道直接拿 stdout/exit code,更可靠。
**否决 C:ACM/LE 真证书。** IP 直连无域名,HTTP-01/TLS-ALPN 走不通;DNS-01 要求用户有域名+DNS API,违背「提供一台能外网访问的机器即可」的前提。

新依赖:`rcgen`(纯 Rust X.509 签发,配合已装的 aws-lc-rs 后端)。理由:证书必须在桌面现场生成且私钥不出本机,无系统级替代(Tauri 侧调 openssl CLI 不可移植且破坏零外部进程约束)。

## 设计

### 前端(全部在 `src/plugins/web-access/`)

- `index.tsx`:tabs 改为 lan / cf / selfhost / devices 四项;`WebWanPane` 拆为 `WebCfPane`(现文案删去「导 zip 到 ECS」路径,只讲 Worker)与 `WebSelfHostPane`,两 pane 各经现有 `WebWanGate` 风险弹窗包裹;两 pane 底部各挂 `<WebRelayCard />`。
- `WebSelfHostCard.tsx`(新):
  - 表单:host、port(默认 22)、user、认证方式(密码 / 私钥粘贴或路径 + passphrase);凭据仅本次部署使用,不落盘(与 CF Token 同纪律)。
  - 「一键部署」→ 调 `relayDeploySelfhost`,进度状态机:连接 → 铸证书 → 上传 → 装 systemd → 健康自检;步骤列表实时打勾,失败显示服务器端 stderr 尾部。
  - 成功:URL/key/证书指纹自动写 settings(连接卡即时回填,复用 0ebcda7 的回填通道),提示点「连接中继」。
  - 折叠「手动部署指导」:前置要求(公网 IP、root 或 sudo、云安全组放行 443)+「导出部署包」(zip:mjs、cert/key.pem、env、service unit、三步命令 README,key 与证书已烧入)+ 与现 ECS 完全一致的三条命令。
- 部署步骤纯函数(状态机 model)拆 `selfhostDeployModel.ts` 便于单测(先例:relayStatusModel)。

### Rust(`src-tauri/src/web/`)

- `relay_selfhost.rs`(命令面,≤300 行,超限再拆):
  - `relay_deploy_selfhost(req) -> SelfhostDeployResult`:`{ url, key, certDerB64, fingerprint, sshBanner }`。
  - `relay_selfhost_pack(path, host) -> key`:手动兜底 zip。
- `selfhost_assets.rs`:`include_str!` 内嵌 `tmd-relay-server.mjs`(从现 ECS `/opt/tmd-relay/` 收编进 `src-tauri/deploy/relay/`,成为唯一事实源)+ systemd unit / env 模板渲染 + rcgen 铸证(SAN=IP)。
- `selfhost_ssh.rs`:一次性 exec(`connect_ssh_handle` → `channel_open_session` → `exec` → 收 stdout/stderr/exit);认证复用 `resolve_ssh_auth_material`;known_hosts TOFU(未知即记录并在结果回显指纹)。
- 部署脚本(单条 bash heredoc,幂等):mkdir /opt/tmd-relay → 写 mjs/env/cert/key(base64 分块)→ 写 unit + `systemctl enable --now tmd-relay` → `curl -sk https://127.0.0.1/healthz` 自检 → 输出 `TMD_DEPLOY_OK`。文件传输走 exec + base64(不依赖 sftp 服务端)。
- `pinned_tls.rs`:verifier 接受「期望 DER」入参;`dial_agent` 从 settings 读 `webRelayCertDer`/`webRelayCertHost`,命中 host 才用动态锚,否则回落内置 DER(现 ECS 不受影响);非钉住主机仍走 webpki-roots。
- `pair.rs::mint_offer`:relay 为 https 且 settings 有动态证书时,offer 增 `"pin": "<base64 SHA-256>"`。

### 手机壳

- `creds.ts` 增可选 `pin`;`PairingScreen` 存 offer.pin。
- `PinnedTLS.swift`:除内置指纹外,查 UserDefaults creds 里的 `pin`,按 host 匹配放行;`WsTunnel`/`PinnedHttp` 共用。

### settings 新键

`webRelayCertDer: string`(base64 DER)、`webRelayCertHost: string`。旧版兼容:缺省 = 回落内置钉。

## 错误处理

- SSH 认证失败/主机不可达/端口被占/healthz 超时 → 步骤状态机停在对应步,展示服务器 stderr 尾 20 行;settings 不写半成品(url/key 仅在 healthz 通过后一次写)。
- 部署中途失败:unit 可能已存在旧版 → 脚本天然幂等(覆盖文件 + restart),重放即恢复。
- 手机对旧 pin 的服务器:WS 握手失败 → 提示重新扫码(offer 带新 pin)。

## 验证

1. 单测:rcgen 证书 SAN/指纹、env/unit 模板渲染、pack zip 清单、selfhostDeployModel 状态机、pinned_tls 动态锚选择。
2. 活体:对现 ECS 123.249.45.144 跑一键部署(幂等重放,即端到端测试),桌面绿连,手机热点重扫新码后外网可用。
3. 桩目检(1421):四 tab 布局、Cloudflare pane 文案、自建 pane 表单/步骤渲染。
4. 门禁:typecheck / test / arch-boundary / file-size / build;Rust 侧 cargo test / clippy -D warnings / fmt;react-doctor 100。

## 交付面(改动清单)

- 前端:`index.tsx`、`WebSelfHostPane.tsx`、`WebSelfHostCard.tsx`、`selfhostDeployModel.ts(+test)`、`WebCfPane.tsx`(由现 WebWanPane 改)、locales(en/ja/zh)。
- Rust:`web/relay_selfhost.rs`、`web/selfhost_assets.rs`、`web/selfhost_ssh.rs`、`web/pinned_tls.rs`、`web/pair.rs`、`deploy/relay/tmd-relay-server.mjs`、`Cargo.toml(+rcgen)`。
- 壳:`PinnedTLS.swift`、`src/mobile/creds.ts`、`PairingScreen.tsx`。
- 文档:落地后更新 `docs/architecture/12-web-remote-access.md`。
