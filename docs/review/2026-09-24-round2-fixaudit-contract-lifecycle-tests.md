# 第二轮 code review:修复审计 / 线协议契约 / 生命周期恢复 / 测试质量(2026-09-24)

状态:已完成(评审 + 修复 + 补测同轮收口)
范围:同日第一轮(docs/review/2026-09-24-mobile-web-114-commits-review.md)之后的换角度二审。四切片:第一轮修复本身(FixAudit)、三方线协议契约(手机↔中继↔桌面)、生命周期与故障恢复、测试质量与覆盖缺口。方法不变:四路 reviewer 逐文件取证 + 主审逐条对源码核实后修复。

## 结论

无 P0。第一轮修复被抓出 2 个真回归并修复(PinnedTLS padding 删尽致自建中继配对必败;relay 杀流不通知桌面致任务泄漏)。新增 P1×5、P2 修 14 项;补测试债 6 件(含第一轮 P0 修复的回归锚与中继 mjs 的 e2e 固化)。四切片独立确认的干净面:帧 schema 全集对齐、id 语义与顶替收口、心跳/退避数学、watch stop 传播、spawn abort 覆盖、设备表原子性、kick 即时性、第一轮修复面其余全部核实。

## 第一轮修复的回归(FixAudit,均已修)

1. **PinnedTLS b64DecodeLenient 删 padding → 一次性 pin 静默降级**:Foundation 严格要 padding,43 字符解出 nil → 配动态钉自建中继必败(现服恰为内置钉 host,冒烟测不出)。修:strip 后重补 `=`。
2. **relay 主动杀 ws 流不通知 agent**:phone backpressure/flood 两路径 killStream 不发 close → 桌面 LiveSocket 永久存活持续泵输出到未知 id。修:杀流前补 `toAgent close`(agent replaced/disconnected 路径本就全清场,不需要)。
3. 附带:ws.rs 并发帽 try_send 丢响应(主审自查先行修复);locale 手术 4/8 空格缩进导致两键漏检跨域死重复(归正后重扫清 4 键);fake-relay shebang 半改。

## 线协议契约(ProtocolContract,P1×3 已修)

4. **SSH 泵缺 UTF-8 跨 chunk 缝合**:`pty://out` 同一契约两个泵保真度不一致(russh Data 边界劈 CJK = 每劈点 U+FFFD)。修:pty_spawn 的 decode_utf8_chunk/flush_utf8_tail 提 pub(crate),io.rs 泵持 tail 缝合、收尾 flush。
5. **会话打开输出缺口**:先快照后订阅留 (T1,T2] 不可恢复缺口,流式会话必丢中段且劈 ANSI 时 VT 错位。修:先订阅缓冲、快照后按序排空(重复窗仅服务端毫秒级)。
6. **载荷预算跨层不协调**:>4MiB 写入/大文件预览经中继 = 整条 WS 断流 + 重连循环,而非单请求报错。修:手机 invoke 3.5MiB 带内快败;agent 出站帧 30MiB 守卫改发 Error 断单流不断链;预算链注释钉在 relay_core。
7. P2 修:mjs 帧型别透传(isText);event_sink Lagged 带内 event-gap 信号 + 手机重拉重建;Set-Cookie 合并注释纠偏(潜伏无生产者)。

## 生命周期恢复(LifecycleRecovery,P1×2 已修)

8. **卡死拨号窗口恢复全失效**:黑洞网络下 socket 悬 CONNECTING,openTimer 只放等待者不灭 socket → ≤60s 内回前台/手动重试全部 no-op。修:forceReconnect 对非 OPEN 现存 socket 复用拆线序列。
9. **离家后中继永不接管**:自动竞速只在启动探测,onClose 永远重拨死 LAN。修:RemoteEndpoint 携带全候选表,DialPolicy(新拆 transportDial.ts)按连续失败轮换,pickChannel(auto) 下发全表;单次失败不切防误切。
10. P2 修:spawn_http 句柄收尾统一 abort + writer 5s 兜底;ws 流表补帽(对称 http 面);settings 三写者换锁内 RMW(update_settings);配对改串行 LAN 先行(不再烧中继失败预算);revoke 在途 invoke 取舍注释钉明。暂缓:4001+pending 直连壳分裂(现网不可达)、双 relayKey 顶替战争熔断(需配置错误才触发)、reqwest 全局超时(桥路由均限时)。

## 测试质量(TestQuality:无假绿,补债 6 件)

- 现有套件全部测消费者可观察契约,钉实现应删清单为空(两处 include_str! 形状钉是有事故背书的漂移防线)。
- 补:relay_agent 三防回归锚(体限断流+移除/TTL 清扫/流表帽常量钉);中继 mjs e2e 固化(vitest 起真进程:错 key 403 / 流往返 / 顶替清场);setEndpoint 清闸回归锚(退避期内换端点首连立即拨);ENGINES↔桌面插件 profile 对齐(activate 捕获,cmd+resumeArgs 双钉);ENGINES↔conn.rs 桥闸对齐(include_str! 扫描);relayStatusDot token 存在性(themes.css 双主题)+channel.test 死 mock 删除。
- 判定不补(明说不摊饼):SessionScreen 竞态修法(无组件测试基建,为 3 行守卫引依赖不值)、ws.rs 并发帽(需伪造 WebCtx 成本远超收益)、slug 跨端(已被 sessionFile.test 真实实现覆盖)。

## 文件规模(300 行铁则)

二轮补强后四文件过线,处理:transportBridge.ts 拆 DialPolicy(拨号策略状态机)后标记 file-size-exempt(桥状态机核心单一所有权,与 ipc.ts 同性质);SessionScreen 抽 useLiveStream.ts hook(229+89);HomeScreen/ws.rs 注释收敛。

## 验证

- Rust:cargo test 300 绿(新增 3)/ clippy -D warnings / fmt 干净。
- 前端:typecheck / vitest 337 文件 2830 测试绿(净增 12)/ arch-boundary / file-size / build / react-doctor 100。
- 中继 mjs:e2e 测试(起真进程)2 例绿;node --check 过。
- 壳:xcodebuild(iOS Simulator)BUILD SUCCEEDED。
- 部署提示(同第一轮):线上 ECS 需重跑「一键部署」;真机需装机回归(端点轮换/卡死拨号恢复/安全区)。
