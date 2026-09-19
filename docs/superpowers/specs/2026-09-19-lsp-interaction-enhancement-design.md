# LSP 语义跳转交互增强(二轮):手势反馈 / peek 面板 / hover 渲染 — 设计

- 日期:2026-09-19
- 状态:已批准,实施中
- 关联:`2026-09-19-lsp-semantic-navigation-design.md`(初版,c11c29c);本轮源自对初版的一轮 review,缺陷清单见下「背景」

## 背景与目标

初版落地后 review 发现一组交互逻辑缺陷与反馈缺失,关键项:

- **P1 活跃使用 10 分钟后该 tab LSP 永久失效**:`touchActivity` 只在 `getSessionForPath` 建连路径调用;cmLsp 缓存 session promise 后 hover/定义/didChange 不再续期,idle timer 到点照杀;且关停后 cmLsp 侧缓存 dead conn 永不重建。
- **P1 F12 焦点泄漏**:`activeView` 只 focusin 置位永不清空,终端聚焦后 F12 仍被 lsp 命令吃掉,作用在非聚焦编辑器。
- **P1 陈旧结果覆盖**:并发请求无 seq,慢的后到覆盖先到的 peek。
- **P1 peek 假阳性**:tab 关闭后 host 随 DOM 移除但全局变量非 null,`peekOpen()` 恒 true,Escape 被白吞。
- **P2 反馈缺失**:cmd+hover 无链接态预告;definition 无 loading;`sessionReadyForPath` 死代码(右键未置灰,spec 欠账);peek 键盘不可导航、列表不联动预览;滚动即关 peek;右键空白也弹;200 条静默截断;hover markdown 原文裸露;shutdown 以 notification 发;右键菜单与 peek 文案 i18n 欠账。

目标:修正全部 P1/P2,把手势反馈(cmd+hover 链接态、延迟 loading)、peek 面板(键盘导航/联动预览/符号区间高亮)、hover 签名渲染(markdown)补齐到 VS Code 基准线。

## 方案取舍

### 取舍一:cmd+hover 链接态的命中判定 —— word 级本地判定 vs 预取 definition 确认

**选定:word 级本地判定,零 server 调用。**

- meta||ctrl 按下后 mousemove → `posAtCoords` → `wordAt` → mark decoration(下划线+手型);keyup/移出清空。VS Code 的预告同样是词法级(定义是否真存在按下才知道),预取 definition 会把每次悬停变成一次 server round-trip,悬停扫过密集代码时是请求风暴。
- 被否决:预取 definition 确认后高亮 —— 准确但请求量大,且与 mousedown 真实请求重复。

### 取舍二:hover markdown 渲染 —— 自建 markdown-it 实例 vs 复用 files 快路径

**选定:lsp 插件自建 markdown-it 实例(`html:false`),fence 渲染复用 kernel 化的 Prism 高亮器。**

- markdown-it 已是直接依赖,零新增;`html:false` 默认防注入,链接不导航(纯展示)。
- 配套上移:`plugins/files/markdown/syntax.ts` 的 `highlightLine` 是通用代码高亮原语(Prism + LRU + sanitize),lsp 与 files 双消费 → 按「跨插件基础契约沉淀 kernel」上移 `src/kernel/syntaxHighlight.ts`;其依赖 `hashStableString` 同步上移 `src/kernel/textHash.ts`(R1:kernel 不得 import 插件,连带移动是唯一合规路径);files 4 处 import(MermaidBlock/fastPath/markdownBlocks/FileStructuredPreview)改道,干净切换不留 re-export 壳。
- 被否决:①lsp 直接 import files 插件私有模块 —— 插件互导旁路,违背注册面纪律;②手写 fence 剥离正则 —— 行内 markdown(粗体/链接/行内码)全丢,渲染质量回退。

### 取舍三:peek 滚动语义 —— 滚动即关 vs 外点关闭

**选定:外点关闭(document mousedown 捕获 + Esc),滚动不关。**

- VS Code peek 嵌入行间随内容滚动,本实现对齐其「停留」语义的下限:浮层停留,用户可滚编辑器对照;外点/Esc/新动作关闭。
- 被否决:维持滚动即关 —— 边滚边对照引用做不到,初版属过度关闭。

### 取舍四:definition loading —— 立即上屏 vs 延迟 250ms

**选定:延迟 250ms。**

- 快 server(tsgo 热连接 <100ms)下立即上屏是闪屏;延迟窗内返回则不显 loading,超时未回才 showPeekLoading。references 同步改延迟款。
- 被否决:无 loading(初版)—— 慢 server(pyright 大仓/jdt 索引期)点了像没反应。

## 变更清单

### kernel

- 新增 `src/kernel/textHash.ts`:`hashStableString` 上移(自 markdownBlockSegment)。
- 新增 `src/kernel/syntaxHighlight.ts`:`highlightLine` 上移(自 files/markdown/syntax.ts),files 4 处消费改道;`markdownBlockSegment.ts` 自身改从 kernel import hash。
- `src/kernel/lsp/lspClient.ts`:`closeLspConnection` 的 shutdown 改 request(2s 超时尽力)→ exit notification → lspStop。

### plugins/lsp

- `session.ts`:`touchActivity` 挂进 didOpen/didChange/request 包装(真实请求才续期);`sessionReadyForPath` 保留供右键置灰消费。
- `cmLsp.ts`:①模块级 seq 防陈旧(请求回来比对,过期不上屏不跳转);②`hasActiveEditor` 改判 `activeView.dom.contains(document.activeElement)`;③`ensureSync` 复用缓存前查 `lspConnectionState`,非 ready 弃缓存重建;④lifecycle destroy 收浮层;⑤definition/references 延迟 loading;⑥右键:无 word 不弹、opening 态 disabled;⑦hover 走 hoverCard;⑧接 linkHint。拆出后守 300 行。
- 新增 `linkHint.ts`:cmd+hover 下划线 ViewPlugin(mark decoration + mousemove/keydown/keyup 追踪)。
- 新增 `hoverCard.ts`:markdown-it 渲染 hover text,fence 走 highlightLine 带语言徽标。
- `contextMenu.ts`:label 走 `t()`;disabled 态 + 「语言服务启动中…」。
- `peekWidget.ts` / 新增 `peekList.ts`:`PeekItem` 补 range(UTF-16 行列);键盘导航(↑↓/Enter/Esc、选中态、scrollIntoView);选中/hover 联动预览;列表行补行文本(唯一文件去重读,前 80 项,dir 退 title);预览行 Prism 语法高亮 + 当前行符号区间行内 span 高亮(clamp 单行);截断标题「引用 (N,显示前 200)」;close 路径回焦编辑器;`peekOpen`/`contextMenuOpen` 校验 `isConnected` 失连自清;滚动即关移除,document mousedown 捕获关。
- `lsp.css`:链接态/选中行/符号高亮/hover markdown 样式(守 300 行)。
- `locales/en.ts` `locales/ja.ts`:补「检索中…/无结果/无法读取预览/语言服务启动中…/显示前 N 条/定义/引用」等键。

## 验证

- vitest:既有套件保持绿(syntax 测试随上移改道);新增防陈旧 seq、预览区间 clamp、hover 围栏渲染的单测锚定。
- 桩目检(1421,`__TAURI_INTERNALS__` 桩 lsp_* + 假 server):①cmd+hover 下划线;②终端聚焦 F12 穿透进 PTY;③idle 关停后手势复活;④peek 键盘导航 + 预览联动 + 符号高亮;⑤hover markdown 渲染;⑥右键 opening 置灰 + 截断标题。
- 门禁:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`;`npx react-doctor@latest -y` 100 分。
