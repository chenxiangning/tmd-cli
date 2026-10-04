# git log 近 59 笔多角度评审与修复(2026-10-05)

日期:2026-10-05
状态:已完成(修复随本提交;安卓 APK 出包、真机项留大仙)

## 背景与目标

范围 = `HEAD~59..HEAD`(d3017d55 v0.2.8 合并 → e039051f,802 文件 +26707/-9049):
mobile 手机树重做、iOS/安卓原生壳、外网读头风暴三连修、structured-session
结构化会话、左缘 rail、render-health 十一轮、LSP jdt 隔离、0.2.8 打磨轮机械迁移。
目标:业务正确性、跨端兼容(桌面 / src/mobile web / iOS+Android 壳 / relay vs LAN)、
边界、性能、死代码五个角度收口。

方法:6 个只读评审分片并行(mobile-web / 原生壳 / Rust 内核 / cli-shared+structured /
shell+kernel+web-access / 功能插件杂项)+ 主线亲证高危链(读头缓存契约、WS 保活),
每条发现对照工作区代码核实后修复;纯机械 token 迁移面不重复评审。

## 发现与修复

P1(4,全修):

1. **mobile transcript 按「cwd 最新 jsonl」绑定,cliSessionId 全程未参与**
   (sessionFile/sessionHooks/SessionScreen/HomeScreen)。同 cwd 多会话时打开旧会话
   显示别家对话且不自愈。修复:resolveTranscriptPath 全链透传 cliSessionId——
   omp/pi/claude 按文件名 uuid 精确匹配(`<uuid>.jsonl` / `<ts>_<uuid>.jsonl`),
   codex 按 rollout 名含 id(同 id 多文件取最新),kimi 按 `session_<id>` 目录段;
   未绑定/懒落盘回落水位+最新。home 活行补传 spawnedAt 水位。回归测试 5 例
   (sessionFile.test.ts 身份绑定 describe)。
2. **WebBridge.forceReconnect→teardownWs 悬死旧 dial 的 openGate**
   (transportBridge.ts)。invokeOnce 在 ensure() 上无超时兜底,悬一个 = 轮询链
   整体挂死;残留 openTimer 还会误放新 dial 的 gate。修复:teardownWs 补
   openGate/openResolve 释放三件套 + 断 onopen(setEndpoint 重复三行随之收敛);
   invoke 退避表判界改 `BACKOFF_MS.length`(3000 档死数据转活,5 级全消费)。
3. **fs_temp is_upload_artifact 字节切片在多字节文件名上 panic**
   (fs_temp.rs)。`&pfx[..7]` 切在 CJK 内部即 panic,panic 被写前 purge 吞掉 →
   手机选图/截图注入持续失败直到人工删文件。修复:字节面比对 + 回归用例
   (`日本語-upload-1.jpg`)。
4. **安卓壳未注入 `__TMD_DEVICE_NAME__`**:全部安卓设备在桌面设备表同名「手机」,
   重连拨号 &name= 缺失。修复:MainActivity 注入 `MANUFACTURER MODEL`(转义),
   并顺手修安卓壳六项 P2(见下)。

P2(修复 13 项):

- **设备平台徽标硬编码 iOS**(WebDevicePairCard):pair 链全通——POST /pair 带
  platform(UA 判定)→ PairReq/DeviceRegistry/Device(serde default 兼容老行)→
  DeviceWire.platform → 徽标按值渲染,老行回落设备名首字。
- **GitScreen 三路 last-write-wins 竞态**:seqRef 序号失配即弃(load/tapFile/
  loadCommitFiles);openPatch 键含 staged,同 path 双行各自有面板不串台
  (GitViews 同步)。
- **iOS 键盘交互式收起不 blur → kbOpen 滞留**:useComposerSize 新增
  useKeyboardDismissFallback(visualViewport 回满清位;双端无害)。
- **readHeadsBatched 丢异型返回防御**(2026-09-17 实证故障形态未随批量化迁移):
  元素级 `typeof === "string"` 归一,整体非数组补空串保下标对齐。
- **readHeadSessionMeta/readHeadTitle 死代码删除**;PinnedSessions 改走
  readHeadMetasBatch(入 mtime 缓存 + 负结果池,不再绕过契约)。
- **模型清单失败钉死**:ModelMenu 守卫改「空表允许重开重试」,注释成真。
- **GitPanel 远程降级未断数据面**:isRemote 时三钩子收 null 短路,横幅可见期
  不再对远端路径 5s/60s 必败空转。
- **WorktreeZone DirtBadge 缺形状防御**:status files 缺形按空处理(与
  files/gitDecorate 同源同闸)。
- **LSP peek 整文件读风暴**:createPeekFileCache 随 peek 生命周期缓存,行回填与
  预览共享一次读,失败不缓存(回归测试:重复读一次 IO、失败可重读)。
- **FileTreeToolbar Git 开关对远程树是假动作钮**:gitToggle prop,远程宿主隐藏。
- **pty_spawn LogMeta 插表先于 reader/writer 获取**:文件创建+插表压后到双获取
  之后,克隆失败不留孤儿 .log/账本条目。
- **安卓 PinnedTls 双缺口**:非钉住 https 主机回落系统默认校验(iOS
  performDefaultHandling 同律,原实现一律拒);pin 比对 base64 归一
  (base64url/padding 差异不断链)。
- **安卓壳杂项**:CredsStore 加密偏好单例缓存(重拨风暴不再反复 Keystore 初始化)、
  ShellLog 5MB 轮转(iOS 同款)、WsTunnel.shutdown + onDestroy 拆线销毁 WebView、
  onPause/onResume 暂停/恢复、无相机 app 设备拍照走取消回执不崩不卡死、
  子帧/外域资源加载闸(iOS isMainFrame 同语义)、manifest 重复 screenSize 清理、
  gate.tsx 死字段 `__TMD_DEVICE_MODEL__` 删除、mobile KEYS 死导出删除。

## 二轮复审(修复批自身,2026-10-05 同日)

换角度审上一节修复批的工作区 diff(独立 reviewer + 主线逐 hunk),修 3 实锤:

- **P1 web_devices_list 漏序列化 platform**:pair 链前六环全通、徽标渲染就位,
  但唯一取数通道的 json! 行漏该列 → d.platform 恒 undefined,徽标修复断链在
  最后一跳(registry 落盘测试绿掩盖 wire 断链)。补列;devices_tests 补
  platform 落盘回读断言。
- **P1 ModelMenu 自触发无限重试(上轮修复引入)**:空表放行守卫 +
  setModels([]) 新引用 = effect 自循环(菜单开着以微任务节奏空转重试)。
  改:开菜单且 models===null 才拉;关菜单把空表复位 null —— 重开即重试,
  开着不循环。
- **P2 ensure() openTimer 读实例字段**:旧 dial 残留 timer 到点 resolve 的
  是**新** dial 的 resolver(与上轮注释断言相反),新 gate 提前放行 →
  invoke 抛 disconnected 不进重试阶梯。闭包捕获本轮 resolver。
- 顺手:WorktreeZone DirtBadge 的 .catch 失败分支在编辑中丢失(失败 = 未处理
  rejection + 徽标永久转圈),修回;「—」死分支复活。

门禁全绿重跑:test 464/3643、typecheck、arch、file-size、react-doctor 100、
cargo test 340 + clippy -D warnings + fmt。

弃修(记录理由):

- ws_ticks event_subscribed 每帧整帧 serde 解析(纯性能,帧量级 = 事件面订阅集
  过滤后的出站,收益 < 复杂度;复发于 CPU profile 实证再做前缀嗅探)。
- 直连无 pong 死线:有意取舍(ws.rs 注释),不回归。

## 验证

- `pnpm typecheck` / `pnpm test`(464 文件 3643 用例)/ `check:arch-boundary` /
  `check:file-size` / `pnpm build` 全绿;`npx react-doctor` 100 分。
- Rust:`cargo test`(340 过)/ `clippy --all-targets -D warnings` / `fmt --check` 全绿。
- 安卓壳:build-device-android.sh 出包(见下留观)。
- 桩目检限制如实声明:桌面 UI 改动均为条件渲染级(WebDevicePairCard 徽标三元、
  FileTreeToolbar 开关、GitPanel 降级短路),typecheck + 既有测试兜底;远程工作区
  降级与 LSP peek 预览无本机可驱动环境,未做交互目检。

## 留观

- 安卓真机四项 + 外网读头回归(大仙);安卓设备名/平台徽标需重新配对一台验证。
- PinnedSessions 换批量入口后,置顶行标题解析节奏变化(缓存命中路径)真机观察。
- kimi `session_<id>` 目录段匹配依赖 wire 布局稳定;kimiSessions 改布局时同步。
