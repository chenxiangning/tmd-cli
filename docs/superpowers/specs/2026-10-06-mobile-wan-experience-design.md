# 手机外网体验三件套设计:LAN 地址自同步 / 查询缓存提速 / 输入框状态条

- 日期:2026-10-06
- 状态:已落地

## 背景与目标

手机 app 经中继(外网)连桌面客户端的三连痛点:

1. 桌面重启/换网卡后内网地址(端口)变化,手机端凭证里的 LAN 候选滞后,回家也无法自动切回内网直连,只能重新扫码配对。
2. 外网链路 RTT 高:home 历史列表、会话详情(transcript)、时间线全部串行 RPC,首屏白等、详情慢、时间线慢或查不到。
3. 手机输入框裸,无模型/思考档位/剩余额度可见性(桌面 composer 早有)。

目标:外网连上即自愈内网地址;列表/详情/时间线本地缓存瞬时回显 + 后台增量校正;输入框上方常驻 模型+思考+额度 状态条。

## 方案取舍

### W1 内网地址自同步

选定:WS `hello` 帧加 `lan`/`host` 字段(Rust 权威源),手机 gate 收 hello 后 `withFreshLan` 收敛候选并 `persistCreds`。

- 数据源:`WebCtx` 持有服务启动时的 LAN 基址(`src-tauri/src/web/server.rs`),`ws.rs` 组帧注入——不现算、不新增 IPC。
- 手机侧收敛律:`ws://` 前缀 = 内网类候选(中继皆 `wss://`),旧 LAN 候选全量收敛为最新一条置顶;`wsUrl` 属内网类时随迁;通道 pin(字符串形式)钉在旧内网地址时改钉新址;回环地址(桌面无 LAN 接口的 127.0.0.1 回落)不采信。
- 当前连接不动,新候选下次竞速/重启生效。

被否决:手机主动周期性 `web_lan_url` 轮询——hello 推送零额外请求,且天然只在已连上时发生;桌面主动写中继 KV——引入服务端状态,重。

### W2 外网查询缓存提速

选定:`src/mobile/diskCache.ts` 通用 LRU 信封(`{v, host, at, data}`,host 用 hello.host 隔离多桌面),三类数据各配策略:

| 数据 | 键 | 策略 |
|---|---|---|
| home 历史列表 | `tmd.m.hist.v1`,per-workspace-root | 挂载即显;`onServerHello` 前 hydrate 落空(host 未定)时 hello 后补读;扫描波成功才回写,失败保缓存 |
| transcript 详情 | `tmd.m.tr.v1`,LRU 20 | 挂载瞬时回显;`pollTranscript` 增量(size 续读)回写 |
| 时间线 | `tmd.m.tl.v1`,LRU 10 | 瞬时回显 + 增量分段扫描;`appendOnlyTail` 校验锚点命中则续扫,文件截断/换新自动回落全量 |

被否决:Rust 侧 `fs_collect_files` 加 limit 参数(用户提议的 top10)——缓存+增量已把外网体验打到瞬时,动 Rust 扫描语义影响面大且收益边际。

### W3 输入框状态条

选定:`src/mobile/StatusBar.tsx` 置于 `.cp-pill` 上方(与桌面 chips 位置同构);`statusProbe.ts` 复用桌面既有读取器。本轮「外观美化」交付范围即状态条及 chip 细节(横滑/省略号/按压态),composer 本体视觉沿用既有设计,未另做打磨。

- 模型/思考:10 引擎 `readSessionStatus` 映射——omp/pi 经 `piFamilySessions`,codex/grok/opencode/qoder×2 各有纯模块出口;claude/kimi 的读取器原锁在插件 `index.tsx`(mobile 禁 import),本次下放为纯模块:`cli-claude/sessions.ts` 收 `readClaudeSessionStatus`,`cli-kimi/configStatus.ts` 新件收 `readKimiConfigStatus`/`parseKimiConfigStatus`,index.tsx 改 re-export;dsh 读取器是 host RPC(需连接句柄),桥不可及 → null。
- 额度:5 家 profile fetcher 映射(omp/pi/claude/codex/grok;kimi/qoder/opencode 桌面亦无 fetcher),120s 周期 + 点击手动刷 + turnActive 下降沿补拉。**传输层**:真机评审发现 `quota_fetch`(任意 URL)与 `sqlite_query` 均不在 AppDevice 域闸(conn.rs SSRF 收口)→ 额度真机全链路死亡;修复 = 新增 `quota_vendor_fetch`(host 白名单 + 强制 GET + 重定向同律收口 + relay 分支 DNS 复核拒内网),`quota_env_value`/`sqlite_query` 同批放行(env 侧已有 KEY/TOKEN 名收口;sqlite 结构化读与既有任意文件读零边际面),kernel `ipc.quotaFetch` 远程态自动切白名单版。凭据读取:omp 走 agent.db(sqlite_query),pi/claude/grok/codex 走文件读,均桥可达。
- 模型 chip 点击 = 写 `/model`(经 `engineWire` 按引擎 bracketedPaste 契约包 ESC[200~…ESC[201~,与桌面 profileSend 同律,防 codex/kimi/omp/pi 斜杠弹层吞回车),额度 chip 点击 = 立即刷新。
- chip 行 `overflow-x:auto` 横滑,单 chip `max-width:70%` 省略号。

被否决:新增 `session_status` 专用 wire 命令——省一次 256KB 尾读,但状态读取本就走 `fs_read_tail_changed` 尺寸短路,收益不抵协议面扩张。

## 验证

- 全量门禁:`pnpm typecheck && pnpm test`(471 文件 3704 绿)、`check:arch-boundary`、`check:file-size`、`build`;Rust `cargo test`(347 绿)、`clippy -D warnings`、`fmt --check`;`react-doctor` 100/100。
- 浏览器桩目检(vite 1421 + FakeWS 桩,hello 带 `lan`/`host`):
  1. LAN 同步:旧凭证 urls=[relay, ws://192.168.0.99:1111] → hello lan=http://192.168.1.6:49598 → 凭证收敛为 [ws://192.168.1.6:49598, relay] 并落盘;连接面板 Status 行显示 `LAN 192.168.1.6:49598`(current),中继在列。
  2. 列表缓存:预植 2 条缓存会话 → 750ms(磁盘扫描 1.2s 延迟未回)首屏已渲染缓存行;扫描落地后按磁盘真相收敛(活会话与磁盘身份去重)。
  3. 状态条:活会话屏(omp profile,kimi vendor)`kimi-code/kimi-k3-256k | Thinking high | 5h 用 37% · 7d 用 18%` 三 chip 全渲染,chip 行可横滑;该轮桩未模拟 AppDevice 域闸,额度链断裂(quota_fetch/sqlite_query 被拒)被桩掩盖,真机实证后已按上文传输层修复收口。额度口径后按用户指令翻转为已用百分比(displayPercent 直出,2026-10-06 二轮评审随批)。
- 单测增量:Rust hello 帧断言(ws_tests.rs)、transport hello/能力/lan 状态、creds.withFreshLan 全律、diskCache 19 例(信封/host 隔离/LRU/增量)、statusProbe 18 例(10 引擎映射/quota 格式化)、timelineData 增量扫描、claude/kimi 状态下放回归。
