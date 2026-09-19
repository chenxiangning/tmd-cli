# 14 · LSP 语义跳转契约(lsp 插件)

> 状态:已落地(v1 2026-09-19 c11c29c;二轮交互增强 2026-09-19)。
> 范围:`src/plugins/lsp/` + `src-tauri/src/lsp.rs` + `src-tauri/src/lsp_framing.rs` + `src/kernel/lsp/`。

## 分层

| 层 | 位置 | 职责 |
|---|---|---|
| 插件 | `src/plugins/lsp/` | 引擎发现/安装引导/CM 集成/peek/hover/右键菜单(一切 UI 与引擎语义) |
| 内核通用原语 | `src-tauri/src/lsp.rs` | `lsp_spawn/lsp_send/lsp_stop` + `lsp://message`、`lsp://exit` 事件;不懂任何引擎 |
| 组帧 | `src-tauri/src/lsp_framing.rs` | Content-Length 帧提取(自 lsp.rs 拆出,文件规模铁则) |
| 内核注册表 | `src/kernel/lsp/lspRegistry.ts` | `registerLspEngine` 挂点 + `configForPath` 匹配 + `owningWorkspaceRoot` 归属裁决 |

- 内核零引擎知识:引擎声明(command/初始化参数/工作区探测)全部经 `registerLspEngine` 从插件注入;新增引擎 = `src/plugins/lsp/engines/<id>.ts` 一个文件 + `discoverAll` 一行,Rust/内核零改动。
- 引擎发现默认零扫描:owning root + 扩展名双匹配,命中且 `discover` 缓存未解析才扫。
- `@codemirror/*` 运行期一律动态 import(拆包红线,architecture/13 同源)。

## 会话与连接(cmLsp ↔ session ↔ lspClient)

- 每个 EditorView 一份 `ViewSync`(WeakMap 记账):惰性 ensureSync,首个语义动作才 spawn+initialize+didOpen;open 在途期间的编辑置 `dirtyWhileOpening`,开完补一次全量 didChange(LSP 版本号不回退)。
- didChange 走 `EditorView.updateListener` 增量事件,UTF-16 行列换算在 `kernel/lsp/lspPosition`(BMP 外字符升 CodePoint)。
- **续期**:`touchActivity` 挂在真实协议流量上(didOpen/didChange/request 包装),不是只在建连时——否则活跃使用 10 分钟照被 idle 关停。
- **断连自愈**:`lsp://exit` → session state=none;ensureSync 复用缓存前先查 `sessionStateForPath`,死连接弃缓存重建(2s in-flight 去重防双击双 spawn)。
- 关闭顺序:shutdown 改 **request**(2s 尽力,让 server 清盘)→ exit notification → lsp_stop 兜底杀进程。
- 语义动作带 **seq 序号牌**:连续触发时旧请求结果一律作废(防慢响应覆盖新 peek)。

## 交互契约(二轮定稿)

| 手势 | 行为 |
|---|---|
| cmd/ctrl+hover | 词法级链接态预告(下划线+手型,linkHint.ts,**零 server 调用**);松开/移出即消 |
| cmd/ctrl+click / F12 | definition:单目标直跳(openFileAtLine);点在定义上(结果含点击位)→ 引用 peek;多目标 → 定义列表 peek |
| Shift+F12 / 右键「查找引用」 | references peek(includeDeclaration) |
| hover | markdown 渲染卡(hoverCard.ts):markdown-it html:false,fence 带语言徽标 + Prism 高亮,链接纯展示(防 javascript:) |
| 右键菜单 | 空白处不弹;server opening 态两项置灰 + 「语言服务启动中…」;未安装引擎弹安装引导(「暂不安装」永不再弹) |
| Escape | 编辑器局部键位:关 peek → 关菜单,一次一层(不经全局快捷键) |

## peek 面板(peekWidget + peekList)

- 布局:header(标题+×)/ 左预览(行号槽 + Prism 行高亮,当前行整行底色 + **符号区间行内高亮**,UTF-16 列→像素列经 buildCols CJK 宽映射)/ 右列表(文件:行 + 行文本,并行去重读,前 80 项)。
- 键盘:↑↓/Home/End/Enter/Esc,选中行滚动可见;选中/hover 均联动预览;Esc/× 关闭回焦编辑器。
- 停留语义:不随滚动关闭;document mousedown 捕获关外点;owner 断言防跨编辑器/跨插件误杀(浮层 owner 铁则,architecture/13)。
- 标题截断披露:>200 项显示「引用 (N,显示前 200)」。
- loading 延迟 250ms:快 server 零闪烁,慢 server 有「检索中…」。

## 跨插件共享

- 行级语法高亮:`src/kernel/syntaxHighlight.ts`(Prism 自包含语法 + LRU + HTML 消毒);稳定哈希 `src/kernel/textHash.ts`。files 快路径/hover/peek 预览三处同源。
- 打开文件一律 `@kernel/fileTabs`(normalizePath 派生 id,双分隔符双 tab 根治在 architecture 13)。

## 既有边界

- 引擎:v1 仅 jdt.ls;v1.1 typescript(tsgo 兜底 npx 下载,不保证离线零安装)。
- 协议只做语义跳转族(initialize/didOpen/didChange/didClose/definition/references/hover/shutdown);diagnostics/completion/rename 未接。
- Java 语义正确性依赖 `.classpath`(IDE 导入过的项目最准);src/ 全量挂 sourcePath 是尽力近似,依赖类可能找不到定义。
