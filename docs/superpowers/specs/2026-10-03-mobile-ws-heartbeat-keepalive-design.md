# 手机直连 WS 心跳保活设计(治「图片发送第一次失败,重试即成功」)

日期:2026-10-03
状态:已实施(真机目检留大仙)

## 背景与目标

真机实证(大仙 2026-10-03):挂图后第一次发送报「发送失败,消息已保留」,重试
即成功。排查结论 = **真失败**(帧写进被 NAT 静默回收的死 socket,桌面未执行
写入,重试不双发),机制链:

```
选图/拍照(原生全屏面板)→ 打字 → 发送:整窗 WS 零流量
→ 手机网 NAT 30~60s 静默回收空闲 TCP 映射(无 RST,双端无感)
→ JS readyState 仍 OPEN → invoke 写死 socket → Swift 收发报错
→ close 事件 → 桥拒 pending → 「发送失败」→ 桥退避重拨 → 重试成功
```

根因 = **直连路径双向零心跳**(桌面 ws.rs 只被动应答 Ping/Pong 不主动发;iOS
WsTunnel 从不 sendPing;relay 中继路径反而有 queue_heartbeat)。图片流程的
长空闲窗(原生面板 + 打字)使 NAT 回收最易落在它头上,故最易复现。

目标:周期心跳让 NAT 映射不过期(防患)+ 死连接后台自愈先于用户操作(治已病)。

## 方案取舍

选定(大仙拍板「双侧都加」):

- **桌面直连 15s Ping**(ws.rs select 循环加 tick 分支,节拍同
  relay_core::HEARTBEAT_INTERVAL):pong 由客户端协议栈自答
  (URLSessionWebSocketTask/浏览器皆自动),回包即入站流量;写失败 = 对端死,
  收线由客户端重拨。覆盖全部直连客户端(含 Android 壳),无需客户端更新。
- **iOS WsTunnel 15s sendPing + 10s pong 超时**:周期流量双向续 NAT;pong
  超时 = 死线 → cancel 触发 receive 报错 → close 事件回注 → JS 桥退避重拨,
  用户下一次 invoke 已走新线(自愈先于用户操作)。NSLock settled 锁防
  pong/超时双到达双结算;线换代由 task 同一性守卫停摆旧环。
- 300 行铁则腾位:ws.rs(299 行)的三个纯辅助(event_subscribed/recheck_tick/
  kick_tick)拆 ws_ticks.rs(38 行),腾出心跳落位(ws.rs 284 行)。

被否决:

- **只修 Swift**:桌面侧不主动发 → Android 壳/浏览器直连同样裸奔,治标。
- **只修桌面**:死连接检测仍被动——ping 写进已死 TCP 同样无感(URLSession 无
  写超时),ping 失败到 close 事件可能等内核重传超时(分钟级),Swift 侧
  pong 超时才能做到 10s 级自愈。
- **JS 层应用心跳**(桥上发自定义帧):多一层协议状态,且 WKWebView 后台
  定时器节流不可靠;协议级 Ping/Pong 是现成标准件。
- **invoke 重试透传**(sendErr 时桥自动重发一次):原子性破洞——若连接死于
  「帧已送达、应答丢失」之间,重试必双发;显式重试钮留给用户判断是对的。

## 验证

- `cargo test`(335 通过)+ `cargo clippy --all-targets -- -D warnings` +
  `cargo fmt --check` 全绿;ws.rs 284 行 / ws_ticks.rs 38 行(300 铁则内)。
- `swiftc -typecheck`(iOS simulator SDK)三壳文件零错误。
- 前端零改动(重试/重拨链路既有行为,本轮不动);react-doctor 收口 100。
- 真机目检留大仙:挂图长打字(>60s)后首发送应直接成功;shell.log 观察周期
  ping 无 `ws ping dead` 误报(正常网络不应自愈拆线)。
