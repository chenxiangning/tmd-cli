# M2 任务分解

> 纪律:TDD(先红后绿);每任务组完成即过对应门禁;阶段末换角度评审 + 批次提交。

## 1. 壳能力桥(原生 Swift + 前端 kernel/shellBridge.ts)

- [ ] 1.1 前端 `src/kernel/shellBridge.ts`:postMessage→回调 promise 协议 + `isShell()` 闸;单测(mock messageHandlers)
- [ ] 1.2 Swift `ShellBridge: WKScriptMessageHandler`:分发 `notify`/`creds.get`/`creds.set`/`creds.delete`;TmdApp 注册 handler
- [ ] 1.3 通知实现:UNUserNotificationCenter 授权请求 + post(title/body);info.plist 权限文案
- [ ] 1.4 钥匙串实现:Security.framework kSecClassGenericAccount(`tmd.mobile.creds.v1`,AfterFirstUnlockThisDeviceOnly)
- [ ] 1.5 壳工程重出包脚本回归(scripts/build-device.sh 覆盖 native-shell 路径)

## 2. 凭证迁移与持久

- [ ] 2.1 `mobilePairing.tsx`:启动序改「钥匙串优先 → localStorage 旧值迁移(读→写钥匙串→删 localStorage)」;失败回落 localStorage(浏览器/桌面态不变)
- [ ] 2.2 单测:迁移矩阵(仅旧值/仅钥匙串/双有以钥匙串为准/全无=配对屏)
- [ ] 2.3 真机:配对 → 杀 app → 重启免重配(钥匙串生效取证)

## 3. 审批卡(ask 应答)

- [ ] 3.1 窄屏审批卡组件(挂 overlay 或幕布顶部):会话等待态(askWatch isWaiting)+ 标记摘要 + 允许/拒绝按钮
- [ ] 3.2 应答 RPC:经 `session_write` 发键(与桌面幕布按键同一路径;键序按各 CLI 标记正则映射,复用 cli-shared 既有映射)
- [ ] 3.3 单测:等待边沿→卡出现;应答→session_write 载荷断言;应答后卡消失 + 8s 抑制窗不复燃
- [ ] 3.4 真机:CLI 触发 ask → 手机应答 → 桌面幕布同步继续

## 4. 审批线摘要只读

- [ ] 4.1 Rust:`conn.rs` AppDevice 白名单 + checkpoint 只读命令(list/detail 级);dispatch 面单测(写命令仍拒)
- [ ] 4.2 前端:窄屏审批线抽屉/页(复用 checkpoints 插件数据源,只读渲染)
- [ ] 4.3 协议脚本:checkpoint 只读命令断言 + 写命令 403 域闸回归

## 5. composer 窄屏适配

- [ ] 5.1 `#composer-textarea` 窄屏样式审计 + 软键盘 visualViewport 避让
- [ ] 5.2 发送链真机验证(Enter 发送 = session_write 同 RPC)
- [ ] 5.3 引擎选择器/welcome 窄屏可读性(字号/触控目标 ≥44px)

## 6. 本地通知(业务边沿)

- [ ] 6.1 askWatch 边沿 → `shell.notify`「等待确认:{会话标题}」;会话转空闲 → 「{标题} 已完成」
- [ ] 6.2 前台抑制(应用内可见不重复弹)+ 权限被拒降级
- [ ] 6.3 真机:锁屏态 ask → 通知栏可见

## 7. 双通道竞速与手动切换

- [ ] 7.1 凭证结构扩 `{lan, relay?}` 双端点(配对应答带双 URL;旧凭证单端点兼容)
- [ ] 7.2 连接序:LAN 3s 超时 → relay;成功记当前路径
- [ ] 7.3 RemoteHostBar 点开 = 通道菜单(自动/LAN/relay 手动钉选)
- [ ] 7.4 协议脚本 + 桩:双端点竞速矩阵单测;真机蜂窝飞行模式切 relay

## 8. 韧性验收

- [ ] 8.1 回前台(pagehide/pageshow)强制重连 + 磁盘水位回放补差
- [ ] 8.2 断连期列表快照保留(不清 UI,RemoteHostBar 显断线态)
- [ ] 8.3 真机大会话(90 天级)回放摸底(数据喂 M3 soak 风险表)

## 9. 收口

- [ ] 9.1 全门禁 + react-doctor 100
- [ ] 9.2 换角度评审:设计偏离(对照本提案边界表)/兼容性(旧凭证/单端点/桌面态回归)/边界(权限拒绝/钥匙串不可用/双端点全灭)/性能(通知风暴/竞速超时)
- [ ] 9.3 评审修复 + 批次提交
- [ ] 9.4 architecture/12 增补 M2 契约(shellBridge/双端点/白名单扩面);docs/README 索引;本目录归档
