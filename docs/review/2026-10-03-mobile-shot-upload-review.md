# 手机选图/拍照上传与 WS 心跳保活提交后评审

日期:2026-10-03
范围:c1a8a29a(选图 pending 反馈 + 相册/拍照双入口 + takePhoto 桥)+ 4daf1f40(直连 WS 双侧心跳)
方法:三路并行对抗审查(前端交互流 / iOS 原生 / Rust 网络层),实锤当场修复,门禁全绿后收口。

## 实锤与修复(5 修)

| # | 级 | 发现 | 修复 |
|---|---|---|---|
| F1 | 前端 | 「上传中禁发送」只装在按钮 disabled 上,send() 本体无闸:错误条「重试」钮(无禁用)与 ⌘/Ctrl+Enter 键路可绕过 → 文字先发,在途图片 clearShots 后「复活」落单——正是 commit 自述要根治的竞态 | SessionScreen.send() 本体加硬闸 `sending \|\| pending != null \|\| shotBusy`;错误条重试钮随 shotBusy 禁用(UI affordance) |
| F2 | 前端(前置) | 卸载 SessionScreen 时在途上传成功 → 终态 objectURL 永久泄漏(setShots 已 no-op,无人 revoke);头注释「卸载统一释放」虚假宣传 | useShots 加 alive ref:卸载后 onShot 到货即时 revokeObjectURL;pending 预览 URL 各路径本已闭环(审查确认) |
| F3 | 前端(前置) | 错误条 3s 自清裸 setTimeout 不取消旧定时器,交叠时新错误被提前清(<3s) | 定时器归 useShots 单点管理,新错误先 clearTimeout 再起表;attachShot 契约简化为单次上报(UI 策略不进 remote 层) |
| F4 | 壳工程 | NSCameraUsageDescription 双源分叉:只改了 Info.plist,project.yml info.properties 仍旧文案,任何一次 `xcodegen generate` 静默回退(0.1.0/0.2.8 版本分叉即同机制既有实证) | project.yml 同步新文案 |
| F5 | iOS | 拒相机权限后 isSourceTypeAvailable 仍 true(只看硬件不看授权)→ present 出黑屏取景器,注释断言「权限被拒兜住」失实 | AVCaptureDevice 授权态前置闸:denied/restricted 回错误条;notDetermined 走系统弹窗后分流;错误文案如实化 |

## 疑点处置(2 修 4 留观)

- 修 · 保活孤儿连接(S3):页面 reload/WebContent 崩溃重载后 native tasks 残留线在心跳改动后永生(旧版靠 NAT 自然收割)→ WsTunnel.open 建新线时一律拆全部残留(单连接不变量:transportBridge 单 socket),日志记驱逐数。
- 修 · 主线程全幅解码(S5):CameraRelay 拍摄 12MP 解码 0.3-0.8s 卡主线程 → 挪 userInitiated 后台队列,done 收口回主线程保恰一次契约。
- 留观 · present 静默 no-op(S2):呈现动画期/app 切后台时 root.present 被拒 → JS promise 永挂;当前 UI 被 attachShot isBusy 同步闸挡死不可达,未来调用方绕过 busy 才触发(存量同构,activePick 同病)。
- 留观 · pong 预算含握手(S4):慢握手(>10s)在 25s 被误杀,后果仅提前重拨,自愈闭环兜底。
- 留观 · 桌面 ping 臂内联 await send:与 relay writer 任务先例口径不一致;实算无害(2 字节帧即时入内核缓冲,存量 out_rx/events 臂同构),后续架构对齐再动。
- 留观 · ping interval 首跳未消费 + 默认 Burst:连上瞬间即发首枚 Ping、停摆恢复连发;RFC 6455 控制帧任意时刻必须应答,无害;与 relay 先例(Delay + 消费首跳)口径偏差。

## 误报摘录(防重查)

- 双击入口/上传中再点入口:React 离散事件同步 flush + 按钮 disabled + isBusy 闸三重防,不成立。
- iPad 相机 present:`TARGETED_DEVICE_FAMILY="1,2"` 含 iPad,但相机 picker 本就必须全屏,`.fullScreen` 恰是硬性要求,不会异常。
- relay 双跳叠加:手机 WS 终结在中继侧,桌面端 spawn_socket 走 handle_socket,tungstenite 读循环自动冲刷 pong,控制帧不转发手机,两跳各自保活互不叠加。
- 桌面不追踪 pong:ping 臂只判 send Err,iOS 后台挂起不回 pong 不触发桌面误断;反向 iOS 10s 窗充裕。
- ws_ticks.rs 三函数逐字符原样搬迁,语义零漂移;composer 头注释与 i18n 四词条、takePhoto 回传形状与 JS 分流均咬合。

## 测试补强

- 重试钮禁用/pending·挂图共存/chips 语义如实断言(替换「恒真」弱断言);「上传中」改精确子串断言(防 aria 误命中)。
- attachShot 失败契约改为单次上报断言(3s 自清移出后不再断 timer)。
- send() 硬闸在 SessionScreen(重渲染 mock 成本高),由 Composer 层 affordance 测试 + 代码收口覆盖,记入留观。

## 验证

- `pnpm typecheck && pnpm test`(3539 通过)&& `check:arch-boundary` && `check:file-size` && `pnpm build` 全绿;react-doctor 100/100。
- `swiftc -typecheck`(iOS simulator SDK)零错误;Rust 本轮零改动(cargo 三件套随 4daf1f40 已绿)。
- 真机目检留大仙:拒相机权限点拍照出错误条(非黑屏)、首启权限弹窗、reload 后无 `ws open … evicted` 之外的驱逐噪音、拍摄 dismiss 后无主线程卡顿。
