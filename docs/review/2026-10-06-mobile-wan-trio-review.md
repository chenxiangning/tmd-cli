# 手机外网三件套落地后多角度对抗评审与修复

- 日期:2026-10-06
- 状态:已完成(修复随本批)

## 结论

四路并行评审(需求覆盖 / W1 竞态 / W2 缓存 / W3 契约)+ 大仙真机实证 + 主线亲证,共抓 6 P1 / 6 P2,已修 6 P1 / 6 P2;留观 6 项附理由。修复后全量门禁绿(typecheck / test 471 文件 3705 绿 / arch / file-size / build / cargo 349 绿 / clippy / fmt / react-doctor 100)+ dispatch 精确桩终验(AppDevice 域闸模拟)三链路复验通过。

## P1(已修)

1. **额度真机全链路死亡(大仙真机实证 + W3 评审双发现)**:`quota_fetch`(任意 URL = SSRF 面)与 `sqlite_query` 均不在 AppDevice 域闸(conn.rs),手机额度链两处被拒;单测 mock @kernel/ipc、桩目检 FakeWS 有问必答,两层验证都被掩盖。修复 = 新增 `quota_vendor_fetch`(host 白名单 + https only + 强制 GET 丢 body + 重定向目标同律收口 + relay 分支 DNS 复核拒内网/回环/IP 直连),`quota_env_value`(已有 KEY/TOKEN 名收口)与 `sqlite_query`(与既有任意文件+二进制读零边际面)同批放行;kernel `ipc.quotaFetch` 远程态自动切换。测试:白名单/内网拒绝矩阵(v6 方括号剥离坑已钉)、conn_tests 域闸断言翻转。
2. **模型 chip 裸写 `/model\r` 绕过 bracketedPaste 契约**:codex 注释直证裸写在斜杠弹层活跃态吞回车,codex/kimi/omp/pi 4 家中招。修复 = engines 表加 `bracketedPaste` 镜像 + `engineWire()` 发送线唯一出口(BP 引擎包 ESC[200~…ESC[201~),模型 chip 与 composer 主路径两处接线;对齐测试扩三字段(activate 捕获真 profile 防漂移)。
3. **断线扫描波毒化持久缓存**:scanWorkspaceHistory 吞引擎失败为空列表,断桥波以全空覆写 home 缓存(外网高频掉线场景反复清掉首屏)。修复 = 返回 `{items, failedEngines}`,失败波跳过 UI 覆写与缓存回写。
4. **时间线缓存无字节上界**:重度会话数千条 ×0.7KB 顶破 WebView ~5MB 配额,徒劳重试逐条吃光兄弟缓存(hist/tr 连带死亡)。修复 = 单会话 512KB 自尾向头累计裁剪(锚取末条不受影响)+ writeCache ≥2MB blob 直接放弃不逐兄弟键。
5. **hello.lan 同步拆活连接**:setCreds 触发探测 effect 重跑 → configureRemoteEndpoint 无条件 teardown 健康中继线 → 拨不可达内网 8s 超时回中继,旗舰场景每次桌面换址白付断连。修复 = 探测身份键收窄为 `deviceId:token:probeKey:blocked`(urls-only 变更不重探测);桩终验:hello 同步后零新拨号。
6. **spec 白名单前提失实**:spec 声称 quota_fetch/sqlite_query 在白名单(与 conn.rs 矛盾)。修复 = spec 改写为传输层真实方案(见 P1-1),fetcher 数(7→5)、轮询周期(60s→120s)、验证记录措辞(omp profile/kimi vendor 澄清)同步订正。

## P2(已修)

1. 锚校验窗 4096B < 末条行长(贴长日志常态)→ 增量恒失效全量重扫;扩 64KB。
2. 「剩 {p}%」硬编码中文,en/ja 混排;改 t() 三语。
3. serverLanUrl 注释「未连接 = null」与行为不符(断线残留恰是 diskCache 桶键所需);注释改「最近一次 hello,换端点才失效」。
4. lan_ip 过滤律零测试;提取 `lan_v4_ok` 纯函数表驱动(私网三段采信/回环/公网/198.18 假网段拒)。
5. QUOTA_FETCHERS 注释「dsh 无 fetcher」失实(dsh 有但走 host RPC 桥不可及);措辞订正。
6. 美化范围追认:spec 明示「本轮外观交付 = 状态条及 chip 细节,composer 本体视觉沿用」。

## 留观(不修,理由)

1. grok 扫描波无 mtime 闸(存量代码,summary.json 全量重读)——grok 会话多的工作区稳态仍有周期流量;建议后续并入 headCache 同池。
2. quota 迟到覆盖无 seq 守卫(同会话 model 切换窗口,120s 自愈,纯展示)。
3. 换桌面连接的内存态残留窗口(一个扫描波内旧 root 短暂串显,持久面被信封保护)。
4. LAN 切换非即时(回家走中继直到自然断连;spec 已明示「当前连接不动」取舍)。
5. relay 轴放行任意 https DNS 域名(用户自建中转不可枚举;IP 直连/内网解析已拒,公网 DNS 名与 session_spawn 的 SSH 级信任同律)。
6. 「思考 {level}」misc/mobile 双处定义(重复键,i18n 面非行为面)。

## 验证

- 桩终验(dispatch 精确):AppDevice 域闸模拟下额度 chip 渲染 `5h 63% left · 7d 82% left`(走 `quota_vendor_fetch`,gateLog 无 quota_fetch 尝试);模型 chip 点击写入 `\x1b[200~/model\x1b[201~\r`;hello lan 同步后 WS 拨号数零增长(boot 期 isWeb 两次 + relay 探测一次,无 LAN 重拨)。
- 门禁:`pnpm typecheck/test(3705)/check:arch-boundary/check:file-size/build`;`cargo test(349)/clippy -D warnings/fmt`;`react-doctor 100/100`。

## 二轮评审(2026-10-06 收口前,四路并行对抗复审修复批自身)

结论:0 P1 / 4 P2,已修 4 P2;留观补 5(理由附)。修复后 `cargo test(350)/clippy/fmt` 复验绿。

- P2 quota.rs IPv6 收口缺口:ULA(fd00::/8)/链路本地(fe80::/10)/IPv4-mapped(::ffff:10.0.0.1,std parse 落 V6 分支三谓词全 false)均放行。修复 = mapped 剥离按 V4 同律判 + ULA/link-local 谓词补全(V6 无稳定 is_link_local,按位判 fe80::/10);白名单矩阵补三形态断言。
- P2 quota.rs relay DNS 复核 all() 语义倒置:全体内网才拒,双答 DNS {公网,10.x} 过闸。修复 = any 内网即拒;复核后 reqwest 二次解析的 rebinding 时间窗留观(完整防御需连接层钉 IP)。
- P2 quota.rs 重定向目标只过句法白名单无 DNS 复核:relay 首跳 302 → 内网域名直达。修复 = 回调内补同步 DNS 复核(非厂商 host 全部解析可达才跟随,解析失败拒);localhost/不可解析断言钉死。
- P2 gate.tsx 撤销与 hello.lan 同窗竞态:迟到 hello 读旧 credsRef 回写可在 persistCreds(null) 后复活已撤销凭证(reload 后带废 token 自动重拨)。修复 = 撤销先置空 credsRef 再清库(声明前移)。

留观(二轮新增,不修理由):

- quota_env_value 后缀通配向设备暴露全部匹配密钥(非枚举集);SSH 级信任下建议后续收窄。
- sqlite_query 设备域 RW 打开(信任模型内 query_only+单连接挡组合面;WAL checkpoint 边角)。
- 配对瞬间 PairingScreen setCreds 与 hello 同窗理论竞态(概率极低,P2 同款 credsRef 置空可一并罩)。
- withFreshLan 对 https 形态 LAN 静默失效(桌面 lan 恒 http,未来 LAN TLS 才退化,无破坏)。
- STATUS_READERS/QUOTA_FETCHERS 映射无 engines.test 式对齐守护(桌面新增引擎时手机静默降级,下次动表补)。

另:额度口径按用户指令翻转(formatQuotaLine「剩 {p}%」→「用 {p}%」,displayPercent 直出),spec 验收示例同步订正。
- 新增测试:quota 白名单矩阵、conn_tests 域闸翻转、lan_v4_ok 表驱动、engineWire 格式 + 三字段对齐扩展、scanWorkspaceHistory failedEngines。
