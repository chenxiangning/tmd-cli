# M2 任务分解

> 纪律:TDD(先红后绿);每任务组完成即过对应门禁;阶段末换角度评审 + 批次提交。

## 1. 壳能力桥(原生 Swift + 前端 kernel/shellBridge.ts)

- [x] 1.1 前端 `src/kernel/shellBridge.ts`:postMessage→回调 promise 协议 + `isShell()` 闸;单测(mock messageHandlers)(shellBridge.test 4 用例)
- [x] 1.2 Swift `ShellBridge: WKScriptMessageHandler`:分发 `notify`/`creds.get`/`creds.set`/`creds.delete`;TmdApp 注册 handler(ShellBridge.swift 分发 notify/creds.*)
- [x] 1.3 通知实现:UNUserNotificationCenter 授权请求 + post(title/body);info.plist 权限文案(UNUserNotificationCenter + requestAuthorization;被拒静默)
- [x] 1.4 钥匙串实现:Security.framework kSecClassGenericAccount(`tmd.mobile.creds.v1`,AfterFirstUnlockThisDeviceOnly)(Keychain enum(GenericPassword/AfterFirstUnlockThisDeviceOnly))
- [x] 1.5 壳工程重出包脚本回归(scripts/build-device.sh 覆盖 native-shell 路径)(xcodegen+真机出包回归通过)

## 2. 凭证迁移与持久

- [x] 2.1 `mobilePairing.tsx`:启动序改「钥匙串优先 → localStorage 旧值迁移(读→写钥匙串→删 localStorage)」;失败回落 localStorage(浏览器/桌面态不变)(resolveCreds 钥匙串优先+迁移;persistCreds 双写口)
- [x] 2.2 单测:迁移矩阵(仅旧值/仅钥匙串/双有以钥匙串为准/全无=配对屏)(mobileCreds.test 8 用例矩阵)
- [ ] 2.3 真机:配对 → 杀 app → 重启免重配(钥匙串生效取证)

## 3. 审批卡(ask 应答)

- [x] 3.1 窄屏审批卡组件(挂 overlay 或幕布顶部):会话等待态(askWatch isWaiting)+ 标记摘要 + 允许/拒绝按钮(AskFloatingBadge(等待浮标+列表))
- [x] 应答 RPC:经 `session_write` 发键(实现偏离:浮标只导航不代发键——各 CLI 键位语义不一,发错键=批错操作;应答在幕布软键盘完成,待评审确认) —— 评审 A2 确认改道:浮标+幕布人工应答,不自造代发键
- [x] 3.3 单测:等待边沿→卡出现;应答→session_write 载荷断言;应答后卡消失 + 8s 抑制窗不复燃(浮标数据源=host.isWaitingConfirm(askWatch 既有测试覆盖))
- [ ] 3.4 真机:CLI 触发 ask → 手机应答 → 桌面幕布同步继续

## 4. 审批线摘要只读

- [x] 4.1 Rust:`conn.rs` AppDevice 白名单 + checkpoint 只读命令(list/detail 级);dispatch 面单测(写命令仍拒)(conn.rs 白名单 +checkpoint_list/batch_diff(测试翻转))
- [x] 4.2 前端:窄屏审批线抽屉/页(复用 checkpoints 插件数据源,只读渲染)(CheckpointsMobileSummary overlay 挂点)
- [x] 4.3 协议脚本:checkpoint 只读命令断言 + 写命令域闸回归(web-bridge-client.mjs 实测:list 过闸/apply 拒,exit 43/44 哨兵)

## 5. composer 窄屏适配

- [x] 5.1 `#composer-textarea` 窄屏样式审计 + 软键盘 visualViewport 避让(--tmd-vvh visualViewport 避让)
- [ ] 5.2 发送链真机验证(Enter 发送 = session_write 同 RPC)
- [ ] 5.3 引擎选择器/welcome 窄屏可读性(字号/触控目标 ≥44px)

## 6. 本地通知(业务边沿)

- [x] 6.1 askWatch 边沿 → `shell.notify`「等待确认:{会话标题}」;会话转空闲 → 「{标题} 已完成」(AskNotifier 边沿→shellNotify)
- [x] 6.2 前台抑制(应用内可见不重复弹)+ 权限被拒降级(桥缺席 no-op;权限拒静默(应用内浮标照旧))
- [ ] 6.3 真机:锁屏态 ask → 通知栏可见

## 7. 双通道竞速与手动切换

- [x] 7.1 凭证结构扩 `{lan, relay?}` 双端点(配对应答带双 URL;旧凭证单端点兼容)(MobileCreds.urls + pairWithOffer 存全端点)
- [x] 7.2 连接序:LAN 3s 超时 → relay;成功记当前路径(connectAttempt 按序竞速(8s/端点))
- [x] 7.3 RemoteHostBar 点开 = 通道菜单(自动/LAN/relay 手动钉选)(RemoteHostBar 通道菜单(自动/钉选))
- [ ] 7.4 协议脚本 + 桩:双端点竞速矩阵单测;真机蜂窝飞行模式切 relay

## 8. 韧性验收

- [x] 8.1 回前台(pagehide/pageshow)强制重连 + 磁盘水位回放补差(pageshow+visibilitychange→forceReconnect)
- [ ] 8.2 断连期列表快照保留(不清 UI,RemoteHostBar 显断线态)
- [ ] 8.3 真机大会话(90 天级)回放摸底(数据喂 M3 soak 风险表)

## 9. 收口

- [x] 9.1 全门禁 + react-doctor 100(typecheck/2758 测试/边界/300 行/build/Rust 全绿)
- [x] 9.2 换角度评审(reviewer 子代理 17min):2 high(B2 运行期撤销无回配对屏/A1 空闲通知缺触发)+ 2 med(A2 审批卡偏离未回写/E2 协议脚本 checkpoint 断言缺口)+ 4 low;确认 shellBridge 零桌面 RPC 混入、旧凭证回落、双份轮询修复、测试守真契约
- [x] 9.3 评审修复批(B2 常驻撤销订阅+revokedCbs 不清空/A1 turnSettled.unviewed 通知/C3 冷启动基线/E2 checkpoint e2e 断言实测通过/B4 await persistCreds/A2+A4 proposal 回写)
- [x] 9.4 architecture/12 增补「轻交互闭环增补(M2)」节(shellBridge/双通道/撤销/重拨/审批浮标/摘要/键盘避让)+ 修正 M1 节两处过时;真机项(2.3/3.4/5.2/5.3/6.3/7.4/8.2/8.3)留待大仙扫码复验后归档
