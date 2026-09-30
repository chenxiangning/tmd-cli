# 17 - 渲染健康守望(WKWebView 吊销粘死自愈)

- 日期:2026-09-30
- 状态:已落地(38239d71 垫片 + 本轮守望阶梯;洪水降级与合帧写入为 2026-09-30 晚第三轮卡死增补;壳侧心跳守望与泵侧计量为 2026-10-01 第四轮增补)

## 背景与症状

连续多日「界面卡死」报告(01a0edfc/01a0ee67 等 omp 会话):窗口在前台,终端乃至整个 UI 冻结在数小时前的旧帧;会话、PTY、Rust 泵全程健康(日志持续增长、字节流连续);点击窗口、app 激活均无效。昨天的「五态点位」修复(b719ab67)与「rAF 失活垫片」(38239d71)均未根治——用户整夜运行含垫片的构建,清晨仍复现。

## 根因(2026-09-30 受控复现定性)

macOS WKWebView 在窗口隐藏/最小化/被遮挡期间停发原生 rAF 并吊销渲染更新;恢复可见后 **WebKit(macOS 27.0)偶发不再恢复**。受控实验(worktree 诊断实例,双心跳信标直连 vite)实证:

- `hide() → 90s → show()`:窗口已恢复,页面 `document.hidden` 恒粘 `true`、原生 rAF 永久死、像素停在旧帧;≥500ms 定时器照常跑。100+ 秒无自愈。
- 无效恢复路径(全部实测):app 激活(`open -b`)、JS `set_focus`、`hide()/show()` 重放、1px resize 抖动(且引发 IPC custom protocol 风暴 + 页面重载噪音)、窗口状态未稳时的页面 reload(新页面生在粘死态)。
- 垫片(50ms 定时器兜底 rAF)对「部分遮挡」形态有效(实测 ~14fps 地板帧率),对「吊销态」无效——50ms 级定时器同样饥饿。
- pmset 证实机器整夜未睡、显示器未关(ttyskeepawake):触发条件为纯窗口级遮挡/隐藏,与系统睡眠无关。

## 方案

两层防线 + 壳侧阶梯击打:

1. **JS 守望**(`src/kernel/rafFallback.ts`):模块加载期先捕获原生 rAF 引用养探针;1s 看门狗监测原生 rAF 间隙。
   - 形态 A(遮挡粘死):gap ≥ 10s 且 `document.hidden === false` → 自动上报 `render_health {ok:false}`。
   - 形态 B(隐藏粘死):gap ≥ 10s **不论页内 `document.hidden` 真伪,一律上报**,由 Rust 按 `window.is_visible()`(OS 侧真值)裁断击打。修订(0.2.5 真机回归):旧设计 hidden 即静默、只靠 Focused 事件再戳探针 —— 窗口已聚焦时不再有 Focused 事件,吊销恢复后 `hidden` 恒粘 true 的页面阶梯永久停在首击 set_focus,黑屏不愈(用户侧表现为「意图画布打开黑屏」回归);页内标记会说谎,可见性裁断权单一归 Rust。
   - 恢复上报(ok:true)免去重,清 Rust 侧 strikes。
2. **Rust 阶梯**(`src-tauri/src/render_health.rs`,AppState 持 KickState):
   - `render_health` 命令:ok → 清 strikes;!ok 且窗口可见 → 击打。
   - 阶梯:首击 `set_focus`(15s 去重);二击起 `location.reload()`(60s 冷却,冷却内退 focus)。
   - Focused(true) 钩子(app_setup 主窗口):戳探针 + 4s 应答死限;超时无上报(页面悬死/探针未装)直接进击。

配套:`PluginBoundary` 塌陷呈现从静默 null 改为就地可见错误条(归属插件 + 原因)——渲染崩溃塌成空白在深色主题下等同整块黑屏,与粘死黑屏无法区分、现场无从留证。

reload 是被逼出来的根治手段,语义安全性有两重保证:会话/PTY 注册表**跨 webview 重载存活**(sessionAdopt 重载不灭,既有架构);reload 仅在「窗口可见 + 探针确认粘死/悬死」时触发,健康上报即重置阶梯(实测健康页面获焦链全程无误杀)。

## 第三轮卡死增补(2026-09-30 晚,会话 01a0f19b 现场)

守望上线当晚第三轮卡死复现(用户未跑每日汇总,排除 daily-journal 洪水源)。现场取证:三 omp 会话并发工作期,PTY 日志 37MB/57MB/27MB(约 120MB/h);CLI 18:07 已答完、PTY 尾帧已是完整空闲帧,而像素停在「Working…」旧帧 = 像素冻结;WebContent 进程 71 分钟烧 34 分钟 CPU。定性:**守望只管检出与自愈,没管「把主线程从饱和里摘出来」**——omp 等 TUI 工作期以 15-20 tick/s 持续局部重绘,keep-alive 隐藏幕布照单全收逐 tick 直写 xterm(DOM 渲染器每秒数百次行重建 × N 会话),主线程饱和 → rAF 饿死 → 触发守望;洪水未停时 reload = 重放输出缓冲 + 重挂全部幕布,立即再冻结,越自愈越卡。增补三件:

1. **洪水降级**(kernel/floodGauge.ts + render_health.rs):appendOutput 喂字节数进 5s 滑动窗,>256KB(≈50KB/s 持续)判洪水;守望上报随行 `flood`,Rust 洪水期内 reload 降级 set_focus,退洪后下一轮 stuck 照常 reload——自愈不再与洪水对撞。
2. **隐藏幕布合帧写入**(kernel/terminalReplay.ts + TerminalView.tsx):非激活幕布实时字节攒 250ms 合并写一次(与幕布 askProbe 同拍),激活即冲刷;隐藏幕布的 xterm 行重建从每秒数百次降到 4 次,字节流与屏幕通道语义不变。
3. **PTY 泵自适应聚合窗**(src-tauri/src/pty_spawn.rs):8ms 基线,批内排到窗口耗尽/批满(生产者持续前进)窗长逐批翻倍封顶 50ms(TUI 整帧 20fps 量级,观感无差);孤立小块(击键回显)回基线。连续洪峰的事件数再降数倍。
4. **幕布刷新钮与右上工具行**(kernel/terminalRefreshButton.tsx + terminal.canvasRow 挂点,用户诉求;2026-09-30 晚三轮修订):单会话幕布重建的手动出口——点击自增 TerminalView 的 canvasGen 代数,主 effect 重跑 = xterm 销毁重挂 + 输出缓冲回放 + 强制 SIGWINCH(needsForceSync 初值 true)整帧重绘,PTY/CLI 不中断、其他会话零扰动。行布局归内核:TerminalView 渲染右上工具行容器(right 12/top 8),插件经 terminal.canvasRow 挂点贡献同排工具钮(session-viewer 的「结构化幕布」切换),刷新钮收尾最右——同排同款 pill 形制,零宽度耦合。行不设 z:不透明画布浮层(editorCenter.canvasOverlay,z-10)开启时整行隐没其下,结构化视图页不出刷新钮。分工:这里管会话内画面自救(幕布错乱/内容滞留);WebKit 级像素冻结仍归守望阶梯自动自愈(整页 reload 语义),不经此钮。
## 第四轮增补(2026-10-01,壳侧心跳守望与泵侧洪水计量)

第三轮后守望仍有两个盲区:① 洪水判据在前端(floodGauge),webview 冻结后前端旗标随行失效;② 页内自报线(rAF 看门狗)本身就是被冻结的对象——深冻时它不再上报,Rust 侧无从区分「健康静默」与「冻死静默」。增补三件:

1. **洪水标尺真滑动窗**(kernel/floodGauge.ts):跨桶边界间歇洪峰不再系统性漏检。
2. **健康期心跳自证**(kernel/rafFallback.ts):恢复边沿立即上报清 Rust strikes;平时每 5 拍(≈5s)一次心跳自证存活,供壳侧死线判活。
3. **壳侧心跳守望**(render_health.rs `init_watchdog`,app_setup 挂载常驻线程):5s tick;窗口可见但 15s(HEARTBEAT_DEAD_MS)无任何上报 = 吊销深冻(页内自报线已死),壳侧独立进击——kick 防抖 15s、reload 冷却 60s、洪水期降级 focus、洪过下一拍自动升级(阶梯纪律继承三轮)。洪水判定传感器改本进程泵计量:PTY 泵每批喂 `note_pty_emitted`(pty_spawn.rs),`PTY_BYTES_EMITTED` 5s 增量 >256KB 判洪水——洪水闭环全在 Rust 侧,不再依赖前端旗标。

## 方案取舍

- 被否决:纯 JS 修复(吊销态下 JS 画的帧不达像素);`setNeedsDisplay`/objc 级戳醒(Tauri 无暴露面,引 objc2 依赖过重);重建 webview 窗口(比 reload 更重且丢窗口状态)。
- 保留:50ms 垫片(部分遮挡形态有正收益,零成本)。
- 已知天花板:`RELOAD_COOLDOWN_MS` 内若 reload 后仍粘死,退化为每 60s 一次 reload 重试;若 WebKit 连 reload 都不执行(完全进程悬死),只能等用户重启 app——诊断中未见过该形态。
- 第三轮取舍:洪水期禁 reload(改 set_focus)意味着「真吊销粘死恰好赶上长洪水轮」要等轮次结束才自愈(分钟级)——实测可接受;被否决的替代是照常 reload(回放风暴 + 必然再冻结,永不自愈)。合帧写入只对隐藏幕布生效,激活幕布保持逐字节直写(字节保真铁律的可见面不动)。

## 验证

- 单测:rafFallback.test.ts 8 例(垫片 3 例 + 形态 A/B/恢复上报 + 洪水载荷随行);floodGauge.test.ts 2 例(越线/退洪、低速不误判);render_health.rs 阶梯决策 3 例(含洪水降级、降级不绕冷却);pty_spawn_tests.rs 自适应窗 1 例;terminalReplay.test.ts 16 例(含隐藏合帧 2 例);PluginBoundary.test.tsx 2 例(透传 + 可见错误条)。
- 端到端(诊断 worktree 实测):Focused 钩子触发 → 「探针无应答,进击」→ probe 上报「粘死 strikes=1 首击 set_focus」全链日志在案;健康页面获焦链无误杀。
- 真机回归(0.2.5,2026-09-30):打包实例复现「tab 内容 DOM 已渲染、像素不 paint」的黑屏;dev(vite)/prod dist 浏览器/打包四环境全量排查零渲染崩溃,锁定形态 B 停摆 —— 守望缺口修复后,粘死态 ~10s 首报 → 15s 去重后二击 reload 自愈,不再依赖 Focused 事件。
- 第三轮现场定量:卡死会话 PTY 日志 37MB(57MB/27MB 同仓并发),CLI 完成后 PTY 尾帧为完整空闲帧而像素停在旧帧;WebContent 71 分钟 34 CPU 分钟。修复后并发工作期隐藏幕布行重建降两个数量级、洪峰事件数降数倍,主线程余量使 rAF 不再饿死(待长时观察确认)。
- 门禁:typecheck / vitest / arch-boundary / file-size / build / cargo test / clippy -D warnings / fmt / react-doctor 100。
- 待长时真机观察:0.2.6 发版后跟踪「界面卡死」复发率。
