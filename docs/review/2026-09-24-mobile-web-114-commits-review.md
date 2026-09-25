# 手机端与远程连接 114 提交全量 Code Review(2026-09-24)

状态:已完成(评审 + 修复同轮收口)
范围:`ef141d7~1..HEAD`(2026-09-22 起,mobile-m1-pairing 分支 114 提交,174 文件 +12720/-1134)
方法:四路并行 reviewer(Rust web / mobile UI / 前端架构 / 壳与部署)+ 主审复核取证 + 修复 + 验证;焦点 = 边界 / 性能 / 系统兼容 / 插件化遵守 / 死代码。

## 结论

无未修复阻断项。1 个 P0、13 个 P1 全部修复;P2 修 18 项、记录暂缓 6 项。架构四铁则(R1/R3/R4/300 行)机械扫描全绿;四 reviewer 独立确认的干净面:令牌/配对面恒时比较与限流、dispatch 白名单三表防漂移测试、selfhost SSH 无注入面、pinned_tls 无降级旁路、/file 域逃逸防护、liveText 增量合并非 O(n²)、creds 迁移矩阵、iOS16 API 面、插件 activate 注册纪律、cli-shared 准入合规。

## P0(已修)

1. **relay HTTP 请求体无上限累积 → 远程匿名 OOM 杀桌面**(relay_agent.rs):中继在线时任何无凭据者 POST 大 body 即打爆桌面 Vec。修复:Body 臂 8MB 上限超限断流 + PendingHttp 60s TTL 清扫(心跳臂顺带)+ 流表 512 帽;中继侧纵深(MAX_STREAMS=64、流总量/水位闸)。

## P1(已修)

安全面:
2. **spawn 白名单 basename 绕过**(conn.rs):`./claude` 命中 ENGINES = 工作区同名可执行任意跑。修复:含 `/` `\` 一律拒,测试改钉拒绝形态。
3. **中继 agent 顶替旧流搁浅**(tmd-relay-server.mjs):「绿灯但桥死」同源竞态——顶替不杀流 + 旧 close 无权清场。修复:顶替即全量 killStream(e2e 冒烟验证手机收 close 重连)。
4. **中继零背压/解析器无界**(mjs):全链 write 忽略返回值、fin=0 碎片无限累积、控制帧不限长。修复:wrapSocket 自背压(pause/drain)、单流双向水位/总量闸、帧上限(手机 4MiB/agent 32MiB 沿现状)、控制帧 >125 destroy。
5. **壳桥零来源校验**(ShellBridge/QrBridge/NavLog):任意被导航页面可读钥匙串 + 原生 POST 外传。修复:两 handler 主帧闸 + decidePolicyFor 只放行 app:// + http.post 限 https/私网。

功能面:
6. **setEndpoint 陈旧退避闸劫持新端点首连**(transportBridge.ts):LAN 快败装填闸门 → relay 探测烧满 8s,离网冷启动退化 16-24s。修复:换端点即清闸(retryMs/nextDialAt)。
7. **SessionScreen 订阅竞态泄漏**:await 在途卸载 → 桥内监听按会话累积。修复:到站即核 alive。
8. **sessionFile slug 反匹配恒不着火 → transcript 层真机全灭**:磁盘目录名已无分隔符,与带 `/` 的 norm(cwd) 永不相等;omp 根还查错 ~/.pi。修复:改用插件导出的确定性构造(piSessionSlug/ompSessionSlug/claudeProjectSlug),新增 sessionFile.test.ts 钉三家目录形态。
9. **安全区无任何机制**:viewport 无 viewport-fit、css 零 env() → 顶栏/底栏顶进灵动岛与 home indicator。修复:meta 补 cover + .nav/.composer/.keybar/.resume-bar 四处 inset padding(待真机目检终裁)。
10. **WebDevicePairCard 五处未定义 CSS 变量 + 硬编码奶油底**:出码区/头像块透明无 hover。修复:对齐 --tmd-bg-* 真实 token,清尽永不触发的 fallback 噪音。
11. **emoji 违规**(仓库铁律):relayStatusDot ⚪🟢🟡 + mobile 六处 pictograph。修复:状态点换 CSS 圆点类(测试同步),mobile 换内联 SVG / kernel PinIcon / 文本符号(⚠✕ 有桌面先例)。
12. **桌面包背 mobile 树**:main.tsx 静态引 gate → 桌面首包携 7 家 CLI 扫描器。修复:两树对称动态 import。

## P2(已修 18 项)

Rust:dispatch_ssh unreachable!→Err(F5 同型);响应头 HashMap 折叠丢同名头(改 entry 合并);selfhost chmod 600 结果校验(私钥 0644 不再假成功);selfhost persist 统一 event_sink(webview+WS 双面);pinned_tls 根库/verifier LazyLock 全局一次(重拨热路径);ws.rs invoke 每连接 32 并发帽。
前端:WebRelayCard 卸载竞态;ipc onWebRelay 补 catch;grok re-export 壳删除(测试直连);SpawnSheet 引擎表收敛 engines.ts 单源(qoder cmd drift 已现);MobileApp 轮询签名比对后再 set(消 0.4Hz 全树重渲染);pollSig/wsSig 裸拼串改 JSON 编码;动态 import transport 全收敛静态(体积收益为零纯间接层);withResolvers 垫片独立模块置 main 首 import;currentEndpoint 死导出删除。
脚本/词典:fake-relay 头部 node→bun(Bun.serve 实态);i18n 全词典(14 域文件)终检零缺键,清我中途引入的 misc/settings2/ssh 重复 78 键、CF 死键 1 条;PinnedTLS 一次性 pin 解码与 b64Equal 规则对称(base64url 宽松 + 不解码不降级)。

## 暂缓(记录不修)

- liveText 保真边角(CSI J 0/1 行级擦除、CHA 越列、CJK wcwidth):omp 全屏重绘主路径有 12 例测试锚定,边角只影响非主路径折行偏移;wcwidth 需宽度表,超本轮。
- relay_agent.rs 602 行再拆 proxy 解析子文件(流程债,论证已备)。
- ATS NSAllowsArbitraryLoads 收窄(LAN 裸 IP http 所迫,需真机回归)。
- app switcher 快照泄露终端画面(隐私加固,需真机)。
- 触摸目标 keybar/banner 22-25px(辅助条场景可接受)。
- endpointKind 不识 IPv6/CGNAT(仅标签文案)。

## 验证

- Rust:cargo test 296 绿 / clippy -D warnings 绿 / fmt 绿;conn_tests 新增路径形拒绝断言。
- 前端:typecheck 绿 / vitest 335 文件 2818 测试绿(含 sessionFile 新 4 例)/ arch-boundary 绿 / file-size 绿 / build 绿 / react-doctor 100。
- 中继 mjs:node --check 过;本地起服冒烟(healthz、错 key 403、无 agent 503)+ bun e2e(agent 拨号 + 手机 WS 流往返 + 顶替清场)全过。
- 壳:xcodebuild(iOS Simulator)BUILD SUCCEEDED。
- 部署提示:线上 ECS /opt/tmd-relay 仍是旧 mjs——重跑「一键部署到自建服务器」覆盖后上述中继修复才在线上生效。
- 待真机:安全区 padding 目检;壳来源闸/导航闸装机回归。
