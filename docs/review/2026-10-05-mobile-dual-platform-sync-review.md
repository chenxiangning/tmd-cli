# iOS/安卓双端功能同步核对(2026-10-05)

目标:用户 iOS 实测通过,核对安卓壳(mobile-app/android-shell)与 iOS 壳(mobile-app/native-shell)功能是否同步;不同步处补齐。
结论:**14 项壳能力 13 项已同步,1 项实锤缺口已修**——安卓缺「回前台 WS 探测重拨」;另 2 项平台性差异为已知留观(文末)。

## 能力对照表

| 能力 | iOS | 安卓 | 状态 |
|---|---|---|---|
| notify 本地通知 | 权限请求 + willPresent 前台横幅/声音 | HIGH 通道 + contentIntent 点开拉起 + 权限闸 | ✓ |
| log 诊断日志 | Documents/shell.log,5MB 轮转 | filesDir/shell.log,5MB 轮转 | ✓ |
| creds 三件套 | Keychain(AfterFirstUnlockThisDeviceOnly) | EncryptedSharedPreferences + 单例缓存 + 明文回落留痕 | ✓ |
| WS 隧道建连 | ws:// 假协议禁 → 原生 URLSessionWebSocketTask | URL 协议改写解析(ws→http)+ OkHttp | ✓ |
| WS 心跳保活 | 15s ping + 10s pong 死线 + 在途感知顺延 | OkHttp pingInterval(15s,自带 pong 超时拆线) | ✓(在途顺延见留观) |
| WS 单连接不变量 | 开新线拆旧 + 身份闸(tasks[id]===task) | 同(evict stale + remove(key,value) 原子身份闸) | ✓ |
| **WS 回前台探测** | didBecomeActive → 3s ping 探测,死线才拆 | **缺**(onResume 只 webView.onResume) | **已修** |
| http.post | PinnedTLS 钉证书 + 私网明文闸(前导零防) | PinnedTls.client + targetAllowed | ✓ |
| screen.orient | requestGeometryUpdate(async 两路诚实回话) | requestedOrientation | ✓ |
| pickImage | PHPicker 单选 + HEIC→JPEG ≤2048 + single-flight | ACTION_GET_CONTENT + EXIF 旋转 + 降采样 + ≤2048 + single-flight | ✓ |
| takePhoto | 授权态三分支 + single-flight + 相机不可用回错 | ensureCamera 闸 + FileProvider + 同文案回错 | ✓ |
| 扫码配对 | QrBridge(messageHandlers.qr) | qr.start(方法面)+ zxing | ✓(通道异构,web 树归一) |
| 设备名注入 | utsname 拼 + 转义 | MANUFACTURER MODEL + 转义 | ✓ |
| 导航/子帧闸 | app:// only + isMainFrame | shouldOverrideUrlLoading + 域拦截 | ✓ |
| 注入时序 | WKUserScript atDocumentStart | addDocumentStartJavaScript | ✓ |

web 树(功能主体:时间线/列表/会话/Git/键盘条)双端共享同一 dist 包,零壳差异。

## 修复:安卓回前台重拨

症状链:后台 doze 掐网 → OkHttp 线僵死但 JS 侧仍 OPEN(web 层 forceReconnect 只拆 CONNECTING 线,transportBridge.ts `readyState <= WS_CONNECTING`)→ 回前台首次 invoke 挂 15s 超时;OkHttp ping 自愈要 15~30s。
iOS 对策 = 壳层 probeOnForeground(3s ping 死线才拆,活线毫秒级零打扰);安卓 OkHttp 无公开按需 ping,**退化为无条件拆线促重拨**:close 事件 → JS 退避重拨(1~2s)→ 桥「恢复即拉」自愈。改动:WsTunnel.probeOnForeground() + MainActivity.onResume 接线。
首次启动 onResume 时 sockets 空,no-op;onPause 掐 JS 定时器,后台无重拨空转。

## 验证
- `./gradlew compileDebugKotlin` 绿(仅 SDK XML 版本噪音)。
- 真机回归项(留大仙):后台放置 2 分钟 → 回前台 → 首次列表刷新应 1~2s 内完成(原 15s 超时/报错)。

## 平台性差异留观(非遗漏)
- OkHttp 死线不感知在途发送:单帧冲刷 >15s 的极慢上行会被误拆(挂图已端内压缩 ~0.3-0.7MB,1Mbps 上行 ~6s 安全);复发时按 WsTunnel.kt open 处 ponytail 注释升级自管 ping 线程。
- 回前台重拨为无条件拆:活线闪断一次(1~2s 重连),iOS 为零打扰探测;平台设施差异下的最优解,注释已声明升级路。
