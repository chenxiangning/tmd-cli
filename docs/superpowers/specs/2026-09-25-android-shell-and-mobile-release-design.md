# Android 壳与移动端发布集成设计

- 日期:2026-09-25
- 状态:已落地(同日提交)

## 背景与目标

iOS 壳(SwiftUI+WKWebView,`mobile-app/native-shell`)已可用;大仙要求扩展到 Android 并让 GitHub 发布时双端手机 app 一起出包。约束:web 前端(`src/mobile`)零改动为目标;中继/配对协议不动(安卓即新设备扫码)。

## 方案取舍

| 决策点 | 选定 | 被否决 | 理由 |
|---|---|---|---|
| 总路线 | 手写 Kotlin 薄壳(镜像 Swift 壳四能力) | Capacitor / Tauri 2 Mobile | 壳只有凭证/隧道/钉住/导航闸四件事,框架把 Rust 运行时拖进手机,与「手机是纯远程 UI」相悖(2026-09-22 弃 gen/apple 同一逻辑) |
| dist 服务 | `WebViewAssetLoader` 挂**域根** `https://appassets.androidplatform.net/` → assets/dist | `file:///android_asset` | dist/index.html 用根绝对路径 `/assets/...`(vite 默认 base),挂域根才能原样命中;https 形态 origin 让 localStorage 持久可靠 |
| WS 通道 | 全部走原生 OkHttp 隧道(镜像 WsTunnel,自签钉住) | WebView 直连 + mixed-content 放开 | 与 iOS 同安全语义:自签中继证书按 DER SHA-256 钉;WebView 全局跳过 SSL 校验是反模式 |
| 证书钉 | 自写 `X509TrustManager` 比对叶证书 DER SHA-256(内置 relay-cert.der + creds pinHost/pin + offer 一次性 pin) | OkHttp `CertificatePinner` | CertificatePinner 钉 SPKI,与 iOS/桌面钉 DER 语义不一致;自写 trust manager 三方完全对齐 |
| 启动注入 | `WebViewCompat.addDocumentStartJavaScript`(androidx.webkit) | onPageStarted evaluateJavascript | 与 WKUserScript atDocumentStart 等价,竞态免疫;`__TMD_SHELL__='mobile'` 必须先于模块求值 |
| 安全区 | 原生侧 edge-to-edge + WindowInsets 给 WebView 容器加 padding | 依赖 `env(safe-area-inset)` | Android WebView 对 env() 支持不可靠;原生 padding 一处兜住,页面 env()=0 无害 |
| 桥通道 | `addJavascriptInterface("AndroidShell")`,`post(json)` 字符串信封;TS 侧通道检测双轨(webkit / AndroidShell) | 同步返回式接口 | 保持与 iOS 完全相同的异步帧协议(`{id,method,args}` → `__TMD_SHELL_RESULT__`),TS 侧改动最小(~20 行) |

## 改动面

- `src/kernel/shellBridge.ts`:通道检测/发送双轨(webkit 或 AndroidShell),回注入口不变。
- `mobile-app/android-shell/`:Gradle 工程(minSdk 29 / target 35;依赖 androidx.webkit、okhttp、security-crypto、core-ktx);`MainActivity`(WebView+AssetLoader+注入+导航闸+insets)、`ShellBridge`(帧分发+notify/log/creds/orient)、`WsTunnel`(OkHttp WS,`__TMD_SHELL_WS__` 回注)、`PinnedHttp`(http.post 目标闸与 Swift 同规则:https 放行/私网明文放行/前导零拒)、`CredsStore`(EncryptedSharedPreferences,键 `tmd.mobile.creds.v1`)、`ShellLog`(filesDir/shell.log);`res/raw/relay-cert.der`(从 deploy/relay 拷贝)。
- `scripts/build-device-android.sh`:前端 dist → assets 拷贝 → gradlew assembleDebug → adb 安装启动。
- `.github/workflows/release.yml`:新增 `android` job(JDK17+SDK,gradle assembleRelease,tag 时挂 Release、手动触发落 artifact)与 `ios-shell` job(未签名 xcodebuild,zip .app 同规则)——发布时桌面三平台 + iOS + Android 五路产物齐发。
- `.gitignore`:安卓构建产物。

## 验证

- 前端:既有门禁全绿(桥改动有单测锚定通道选择)。
- Android:本机若可装 SDK 则 gradle assembleDebug 编译通过;否则以 CI job 为编译验证,如实报告未真机联调项(键盘 inset/返回手势留待真机)。
- iOS 零改动回归:既有 build-device.sh 流程不动。
