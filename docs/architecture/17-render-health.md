# 17 - 渲染健康守望(WKWebView 吊销粘死自愈)

- 日期:2026-09-30
- 状态:已落地(38239d71 垫片 + 本轮守望阶梯)

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
   - 形态 B(隐藏粘死):`document.hidden` 恒粘 true,JS 无法自知;Rust 在 Focused(true) 时 `eval` 戳 `window.__tmdRenderProbe()`,探针无条件上报,由 Rust 按「窗口已可见」裁断。
   - 恢复上报(ok:true)免去重,清 Rust 侧 strikes。
2. **Rust 阶梯**(`src-tauri/src/render_health.rs`,AppState 持 KickState):
   - `render_health` 命令:ok → 清 strikes;!ok 且窗口可见 → 击打。
   - 阶梯:首击 `set_focus`(15s 去重);二击起 `location.reload()`(60s 冷却,冷却内退 focus)。
   - Focused(true) 钩子(app_setup 主窗口):戳探针 + 4s 应答死限;超时无上报(页面悬死/探针未装)直接进击。

reload 是被逼出来的根治手段,语义安全性有两重保证:会话/PTY 注册表**跨 webview 重载存活**(sessionAdopt 重载不灭,既有架构);reload 仅在「窗口可见 + 探针确认粘死/悬死」时触发,健康上报即重置阶梯(实测健康页面获焦链全程无误杀)。

## 方案取舍

- 被否决:纯 JS 修复(吊销态下 JS 画的帧不达像素);`setNeedsDisplay`/objc 级戳醒(Tauri 无暴露面,引 objc2 依赖过重);重建 webview 窗口(比 reload 更重且丢窗口状态)。
- 保留:50ms 垫片(部分遮挡形态有正收益,零成本)。
- 已知天花板:`RELOAD_COOLDOWN_MS` 内若 reload 后仍粘死,退化为每 60s 一次 reload 重试;若 WebKit 连 reload 都不执行(完全进程悬死),只能等用户重启 app——诊断中未见过该形态。

## 验证

- 单测:rafFallback.test.ts 7 例(垫片 4 例 + 形态 A/B/恢复上报 3 例);render_health.rs 阶梯决策 2 例。
- 端到端(诊断 worktree 实测):Focused 钩子触发 → 「探针无应答,进击」→ probe 上报「粘死 strikes=1 首击 set_focus」全链日志在案;健康页面获焦链无误杀。
- 门禁:typecheck / vitest 3324 / arch-boundary / file-size / build / cargo test 326 / clippy -D warnings / fmt / react-doctor 100。
- 待长时真机观察:0.2.6 发版后跟踪「界面卡死」复发率。
