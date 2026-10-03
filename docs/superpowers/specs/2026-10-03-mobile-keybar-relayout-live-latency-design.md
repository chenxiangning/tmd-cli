# 手机快捷键条两行重排 + 实况 2 秒延迟治理设计

日期:2026-10-03
状态:已确认(大仙拍板布局方案 A:两行大键网格;延迟场景实证 = 终端实况 + 外网中继 + omp /model 方向键)

## 背景与目标

大仙真机反馈两题:

1. **快捷键太小**:会话屏键盘工具条(keybar,点胶囊条键盘图标出现)是单行
   38px 高 / 字号 11px / 11 键横向滚动,触达面积与可读性都不够。
2. **点击键盘页面反馈延迟 ~2 秒**:omp `/model` TUI 按方向键,电脑客户端幕布
   瞬时变化,手机「终端实况」约 2 秒后才变。

延迟排查链(传输层逐环节实读,全部事件驱动、无批帧):Rust 聚合窗 8~50ms →
event_sink BUS → ws.rs 逐帧转发 → 中继 worker tunnelSocket 逐帧直发 → iOS
WsTunnel 逐帧 evaluateJavaScript → 手机端 rAF 合帧。桌面端瞬时是因为 webview 拿
本地 `app.emit` 不走中继;手机的 2 秒锁定在**渲染面**:每一个 PTY chunk(每次
按键回显/omp 整帧重绘)触发 `setLive` → `SessionScreen` 整棵树重渲染 →
`TurnsView` 未 memo,**全部消息的 ReactMarkdown 重新解析** + WKWebView 实况
全文重排,会话越长越卡。另对话视图固有 2s transcript 轮询间隔,发消息上屏同源
迟滞。

目标:快捷键条两行大键(≥44px 触达);实况按键回显降到肉眼瞬时(<150ms 量级);
发消息后 transcript 不再白等 2s 拍。

## 方案取舍

选定(大仙拍板布局 A;延迟修三连):

- **keybar 两行大键网格**:`shared.ts` 键表按行分组 `KEY_ROWS`(行1 导航
  `← ↑ ↓ → ↵` 五键,行2 `esc tab ⌃c Pg↑ Pg↓ model` 六键),`KEYS` 保留为展平
  导出(PTY 序列契约与现有测试锚不动);`KeyToolbar` 渲染两行,每行 grid 1fr
  全宽平铺不滚动;键高 ≥44px、字号 13px(导航行 15px),总高约 100px。软键盘
  弹起/「+」面板展开时整行隐藏的现有逻辑不变。
- **2a 主修(渲染止血)**:`TurnsView`/`AssistantMsg` 加 `React.memo`——`live`
  逐帧更新不再触发全量 markdown 重解析;旧消息仅在 transcript 真变化(poll 出
  新引用)时重渲。
- **2b 合帧降频**:`useLiveStream.feedChunk` 的 `setLive` 从 rAF(≤60Hz)加
  100ms 尾沿节流,尾沿保证最后一帧必达;文本视口 10Hz 观感仍瞬时,WKWebView
  全文重排次数降约 6 倍。
- **2c 写后触拍**:`useLiveTurns` 暴露 `poke()`(清当前拍 + 300ms 后立即补一
  拍,覆盖 CLI 落盘迟滞),`send()`/`answer()` 写入成功后调用——发消息/应答
  审批后对话视图 ~0.3s 上屏,不再等 2s 拍。

被否决:

- **view() scrollback 截尾渲染**:破坏实况区向上滚动看历史的既有交互,且
  alt-screen TUI(omp)视口本就小,收益不成立。
- **transcript 改事件推送**:需桌面新增「jsonl 生长」事件面,RPC 面扩容超出
  本次范围;写后触拍以零新事件面近似达成同目标。
- **键条改「+」面板内悬浮大键**:入口深一层,与「固定几个快捷键常驻」诉求
  相悖。
- **快捷键挂 iOS 键盘 accessory 条**:WKWebView 网页内容无法挂原生键盘附件,
  壳层改动超出本次范围。

## 验证

- `pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size
  && pnpm build` 全绿;`npx react-doctor@latest -y` 得分 100。
- 单测:`KeyToolbar.test.ts` 补 `KEY_ROWS` 行分组断言(行内标签序 + 展平 KEYS
  契约不回归)。
- 目检:手机树 dev 构建(vite.mobile.config)浏览器过一眼两行布局与键序;
  真机目检留大仙——omp `/model` 按方向键,实况回显应瞬时;发消息对话视图
  ~0.3s 上屏。
