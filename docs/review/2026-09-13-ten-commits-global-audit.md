# 近十次提交全局代码审查(边界/架构/性能/兼容/准确性/逻辑)

- 日期:2026-09-13
- 范围:`5788ecf..3555c0f`(wsl 借用修复、workspace 孤儿三连修、activityWatch 两轮根治、settings 拉盘合并两轮、壁纸插件三连提交),累积 51 文件 +4453/-170
- 方法:逐提交 diff 深读 + 关键文件终态对抗复查 + knip 机械扫描 + 交叉切割(竞态/清理/特异性/UA 兜底)
- 状态:已完成;**未发现 P0/阻断级问题**。1 项 P2(退出丢改动)+ 若干 P3 边角,均附定位与修法
- 处置(同日优化轮落地):#1 退出冲刷(pagehide+visibilitychange)、#2 id 黑名单拒收(定稿为「| 与控制字符」黑名单,路径形 id 照收)、#3 判据改「钟老于本轮写入」、#4/#8 维持记录不动、#5 双函数补 Math.max 下限、#6 newWallpaperId 收敛回唯一实现、#7 busy 正则 gated by isAnchored;新增回归测试 ×2(纯 busy 第二轮推钟、id 注入拒收)

## 结论一览

| # | 级别 | 位置 | 问题 | 处置建议 |
|---|---|---|---|---|
| 1 | P2 | plugins/wallpaper/store.ts | 防抖落盘无退出冲刷:改壁纸后 400ms 内退出应用 = 改动丢失 | pagehide best-effort flush |
| 2 | P3 | plugins/wallpaper/WallpaperLayer.tsx | 轮播可见项计数 `\|` join/split,id 未禁 `\|`(手改 JSON 可注入)→ 计数失真 | id 字符白名单或换 `\0` join |
| 3 | P3 | kernel/activityWatch.ts | 纯 busy 轮次第二轮起 `lastContentAt` 陈旧(开轮推钟仅覆盖 `===0` 首轮)→ 活跃轮被派生层判无活动 | 取舍缝:改为「本轮已有 content 则不动」需要轮内标记,记录 |
| 4 | P3 | kernel/settings.ts advanceBaseline | 本地删除落盘后 key 旧戳永久留基线;他实例以不新于旧戳的相同 ts 重建会被误判删除(需时钟回拨/备份回滚触发) | 记录;当前取舍(保双实例丢更新)正确 |
| 5 | P3 | plugins/workspace/utils.ts | anchorPopoverPosition 无下限:窗口 <~390px 时浮层 x 为负出屏 | 补 Math.max(0, …) 对齐 clampMenuPosition |
| 6 | P3 | plugins/wallpaper | newWallpaperId 死代码 + planImport 内联同款 id 生成(knip 双报) | 留一删一 |
| 7 | P3-微 | kernel/hostWatches.ts | busy 正则对未锚定(idle TUI 自绘)会话照算,常驻微量 CPU | 挪到 anchored 判定后 |
| 8 | P3-微 | cli-omp busyMarks `/\d+[sm] >/` | 轮次内输出行形如 "12s >"(构建日志等)误刷 busy 钟推迟结算 30s | 自证高可信的既定取舍,记录 |

## 深水区核查记录(查过、无虞)

- **punch/themeApplied 监听顺序脆弱性已被消除**:3555c0f 把 xterm 底色锚定挪进 kernel terminal.css(CSS var 实时),终端底色不再依赖「壁纸监听先于终端注册」的顺序假设——这是本轮复查确认的最重要架构收益。
- **settings persist 链**:persistChain 串行化防后发先至;persistNow 先写盘后 advanceBaseline(同对象后变异时序列化已完成);写盘期间用户新编辑不在本次 payload 但下轮补齐,自愈。
- **mergeEntries 删除判据**:ts 字段严格 `disk<=base` 才判删,他实例新版复活不误删;与他实例新增(基线无此 key)分支互斥清晰,四条测试覆盖主路径。
- **wsl UNC 孤儿链**:`WSL_UNC_ROOT_RE` 双形态(`\\wsl$`/`\\wsl.localhost`)正确;activate 期回填经 setWorkspaceWslMeta 等值 no-op,幂等;hostId:null 假设本机 UNC 成立(远端形态必带元数据);N 条回填 N 次 persist 仅首启发生。
- **5788ecf**(String 持有修借用):std::mem::take 用法正确,语义不变。
- **Tailwind preflight 兜住 ul/li 改造**:选择器网格从 div+role 改 ul/li 后无缩进/圆点回归(preflight 清 list 样式)。
- **terminal.css 特异性**:`.terminal-view-host .xterm-viewport`(0,3,0)+ !important 对 xterm.css(0,2,0)稳赢,与 global.css/xterm.css 加载顺序无关。
- **FluidBackdrop 生命周期**:dispose 断 RAF/resize/visibility 全部监听;context 随 canvas GC;参数变化走 setParams 不重挂;prefers-reduced-motion 画单帧。
- **knip 死代码**:wallpaper 域 6 条同文件 export 噪声 + newWallpaperId 真死;其余为仓库既有噪声;CI 不跑 knip(仅本地建议)。

## 交叉切割面

- **竞态**:wallpaper store 慢加载护栏(mutatedBeforeLoad)✓;resolvePaths 幂等(双并发同值)✓;persistChain 串行 ✓。
- **兼容**:color-mix/rgb 空格语法/aspect-ratio 均在目标 WebView 基线内;loading="lazy" 对 asset:// 在 WKWebView 不生效则退化为 eager,良性。
- **安全**:fsCopyFile 绝对路径+.git 段防线+不覆写;wallpaper JSON 全量 sanitize;无外网面。
- **架构边界**:R1/R3/R4 CI 绿;壁纸插件对 kernel 的全部触点收敛为「改 token 值」一处(xterm 样式已归还 kernel)。
