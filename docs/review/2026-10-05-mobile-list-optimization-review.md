# 手机列表查询优化评审(2026-10-05,第五轮)

目标:e6087a6f「列表查询优化——视图节流停后台扫描波,会话注册表事件驱动重拉」自身 diff 的边界遵守与正常系影响复核。
结论:**1 缺口已修**(桥恢复补拉),其余边界全遵守,正常系零影响;发现项与留观见下。

## 逐项核对

### P1 视图节流(HomeScreen)
- 锁定域:停扫/降频只在 `homeVisible = route 在 home && !document.hidden` 为假时生效;回 home/回前台 effect 重挂立即补轮(pull/scan 双链都验证)。
- 手动刷新:刷新钮只在 home 可见时可点,`homeVisible=false` 时按钮不可达,停扫守卫无冲突。
- ask 首现通知:正在看的会话由 SessionScreen 实况流检测(askEdgeNotify),不依赖 home 轮询;HomeScreen 轮询覆盖「其他会话」的 ask,他屏时检出延迟 10s→60s —— 边缘场景(用户正看 A,B 来 ask 通知最多晚 50s),接受并留观。
- 名称追赶(NAME_CHASE 5s):后台停扫期间新会话真名解析暂停,回 home 重挂立扫补上;名字晚解析不影响功能。
- 后台真实态:手机后台 WS 多被系统掐,轮询本就全 catch——降频对后台实质零差;真正生效域是「前台但停留他屏」。

### P2 Rust(SessionRegistry 事件源)
- 锁序:五处突变点全部块作用域释放 registry 锁后再调 notify_changed;notify_changed 内 list() 重取两把锁,parking_lot 非重入无死锁(顺序 sessions→activity 与全局一致)。
- 签名去抖:last_sig 初始空串,首事件必广播;活动板 2s 同值上报 sig 不变静默(防风暴);值变才广播。
- 桌面 webview:src/ 全树无 sessions:changed 消费者——emit 对桌面前端仅为无人听的事件分发,零行为影响。
- setup 时序:manage(AppState) 在 builder 链先于 setup,set_notifier 可用。
- 版本兼容:老桌面二进制无白名单行 → subscribe-rejected → 手机侧退回 15/30s 兜底周期,优雅降级。

### P2 手机(MobileApp 事件驱动)
- **缺口(已修)**:settings:changed 链有「桥恢复即拉」先例,新 effect 漏了——断连窗口丢的 sessions:changed 要等 15/30s 兜底。修复 = onRemoteConnection(connected) → 立即 pull,清理链同步注销。
- listen 返回 Promise 的注销:off.then(f=>f()).catch 兜底,同 settings 链先例。
- 兜底周期:LAN 15s / WAN 30s 按活动端点每轮现算,通道切换即时生效。
- 审批轮询(pollHomeWatch)与会话列表(事件驱动)职责分离:前者是磁盘态(checkpoint/ask),后者是注册表态,互不干扰。

## 验证
- typecheck 0 错 / mobile 154 测试 / doctor 100(修复后复跑)。
- 桩目检事件链(上轮):订阅注册/双发合并+1/隔离单发+1/稳态零漂移。

## 留观
- 他屏时其他会话 ask 通知延迟 10s→60s(上述边缘场景)。
- replace_activity 每次值变即广播:活跃会话密集翻转时事件频率上限 = 活动板上报频率(2s),手机端 300ms 防抖吸收,实测无异常。
