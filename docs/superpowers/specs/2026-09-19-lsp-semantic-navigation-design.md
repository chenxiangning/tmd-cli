# 代码符号语义跳转与引用(LSP 通道):cmd/ctrl+click 定义/引用 peek — 设计

- 日期:2026-09-19
- 状态:已落地(c11c29c;验证:cargo framing/假 server、vitest 1733、react-doctor 100、1421 桩目检六场景、tsgo 真机 hover/definition/references 冒烟)
- 关联调研:`docs/research/code-symbol-references.md`(yn 实证:yn 的该能力 = monaco 内置 TS 语言 worker,语义级,非字面匹配;用户拍板弃字面方案,一步到位语义)

## 背景与目标

用户在 yn 中见到 cmd/ctrl+左键点变量/方法拉起引用 peek 浮窗(monaco ReferencesWidget,VS Code 同款),要求 tmd-cli 复刻且必须是语义级。经三项澄清拍板:

- 语言范围:**四语言全上**(TS/JS、Python、Java);
- 交互面:**VS Code 全套**(cmd/ctrl+click 使用点跳定义/定义点引用 peek、Shift+F12 引用 peek、右键菜单两项、hover 悬停签名);
- server 获取:**惰性自动**(发现链 → npx 缓存;java 首用引导下载)。

tmd-cli 现状:编辑器 = CM6(`src/kernel/cmEditor/`),无语义引擎、无点击手势、无 peek 浮窗;Rust 侧 `proc_run` 为一次性收割原语,无长驻双向 stdio 通道;`resolve/which.rs` 有 PATH 解析可复用。

目标:建立通用 LSP 通道(kernel 原语)+ 语言知识插件化(server 发现/配置),在 CM6 编辑器上落地定义/引用/hover 三类语义动作与 peek 浮窗。

## 方案取舍

### 取舍一:前端语义集成层 —— 全自研 vs codemirror-languageserver vs 换 monaco

**选定:全自研薄集成,零新前端依赖。**

- 实测依据(npm pack v1.22.1 审查):`codemirror-languageserver` 的 `LanguageServerClient` **没有 textDocument/references 能力,也无通用 request 逃生口**;截图核心(引用 peek)无论如何需自建。用它必须让第二个 JSON-RPC 客户端与包共挤一条 server 连接(initialize 握手冲突 + 消息扇出 hack),并拖入 v1 不需要的补全/诊断/重命名/格式化(范围错配)。
- 被否决:①codemirror-languageserver + 自建引用 —— 核心功能缺失 + 双客户端分裂 + YAGNI;②整包换 monaco 编辑器 —— 为白送能力换整个编辑器栈,不值;③Tree-sitter/WASM 符号索引 —— 只有大纲/高亮级别,非真引用;④每语言专用协议直连(tsserver/pyright/jdt 各一套)—— 重复建设,LSP 是行业收敛点。

### 取舍二:Rust 通道形态 —— 专用 LSP 原语 vs 复用 proc_run/PTY

**选定:新建 `src-tauri/src/lsp.rs` 长驻双向 stdio 原语。**

- `proc_run` 是一次性收割模型(exit_on_stdout),无请求关联;PTY 通道面向字节幕布,协议语义不属幕布。LSP 需要:长驻进程 + Content-Length framing 解帧 + stdin 写入。Rust 侧只做字节↔消息边界,JSON-RPC 关联在前端(薄,Rust 不懂方法语义)。
- 合规:LSP 是通用协议,入 kernel 同 `sqliteQuery` 先例;语言知识(server 发现/安装引导/初始化参数)全部留插件侧,违反即越界。

### 取舍三:文档同步 —— 增量 vs 全量

**选定:didChange 增量。** CM6 update 的 changes 直接映射 LSP TextDocumentContentChangeEvent,位置换算函数(LSP 默认 UTF-16,CM 内部 code point)单测锚定 CJK/emoji 边界;全量每键击重发大文件不可接受,debounce 会引入服务端位置漂移。

## 变更清单

### Rust(kernel 原语)

- 新增 `src-tauri/src/lsp.rs`:
  - `lsp_spawn(key, command, args, cwd, env)`:长驻 stdio 进程,key = `<workspaceId>:<language>`;读线程解 Content-Length 组帧(粘包/分包/跨 chunk),完整 JSON 消息经 event_sink 推 `lsp://message {key, payload}`;进程退出推 `lsp://exit {key, code}`;
  - `lsp_send(key, json)`:前端组好的完整 JSON-RPC 消息写入 stdin(组帧);
  - `lsp_stop(key)`:收割进程树;
  - 命令注册进 commands 面,ipc.ts 加包装。
- cargo 集成测试:帧解析(分段/粘包)、spawn/stop 生命周期、假 server(预录 JSON-RPC 脚本)往返。

### kernel 前端 `src/kernel/lsp/`

- `lspClient.ts`:JSON-RPC 薄层 —— id 计数/pending 关联/超时(hover 5s,references 10s)/`$/cancelRequest`;server→client 请求最低限应答(`workspace/configuration` 回默认、`client/registerCapability` 回 ack;不回应 pyright/jdt 初始化会卡死);通知分发。
- `lspRegistry.ts`:插件注册面 —— `registerLanguageServer({ language, extensions, discoverChain, initializeOptions, resolveRoot })`;kernel 不含语言知识。
- `cmLsp.ts`:CM6 集成 —— hoverTooltip(textDocument/hover)、`domEventHandlers` mousedown 手势((meta||ctrl)+左键)、didOpen/didChange 同步(update listener → 增量)、UTF-16↔code point 换算。
- `peekWidget.tsx`:monaco ReferencesWidget 同款浮窗 —— 符号行下方嵌入面板,左 = 目标文件只读源码预览(复用 cmEditor 语言包,滚动至引用行并高亮当前项),右 = 引用列表(文件路径/行号/行内容裁剪),点击 `openFileAtLine` 跳转;Esc(局部 handler,不经全局快捷键)/点击外部关闭;loading 态可取消。
- 语义动作路由(手势/命令共用):点击使用点 → definition 单目标直跳 `openFileAtLine`、多目标 peek;definition 结果包含当前位置时视为「点击定义处」→ references peek(含声明,对齐截图「引用 (N)」)。

### 插件 `src/plugins/lsp/`

- 四语言配置(经 activate(ctx) 注册面登记):
  - ts/javascript:**按工作区 typescript 形态分叉**(2026-09-19 探活实证:TS7(tsgo 原生包)无 `lib/tsserverlibrary.js`,typescript-language-server 与之不兼容直接报「Could not find a valid TypeScript installation」)——
    工作区 `node_modules/typescript` 存在且含 `lib/tsserverlibrary.js`(TS5 形态)→ `typescript-language-server`(发现链:工作区 `.bin` → `which` → `npx -y typescript-language-server --stdio`;工作区 `node_modules` 注入 PATH 供 tsserver 解析);
    否则(TS7 / 无 typescript)→ tsgo LSP(发现链:工作区 `.bin/tsgo` → `npx -y -p @typescript/native-preview tsgo --lsp --stdio`;**`--stdio` 必带**,裸 `--lsp` 默认非 stdio 传输直接退出);
  - python:venv `pyright-langserver` → `which` → `npx -y -p pyright pyright-langserver --stdio`(bin 名 ≠ 包名,须 `-p`;探活:全局 pyright-langserver 握手 OK,hover/definition/references 全有,server→client `client/registerCapability` 请求须 ack);
  - java:无自动发现;首开 .java 弹引导卡片(JDK≥17 检测 → 下载 eclipse.jdt.ls 发行包至 `~/.tmd-cli/lsp/jdt/`,源 = `download.eclipse.org/jdtls/milestones/<ver>/latest.txt` 解析文件名(2026-09-19 实测 200);installer.rs 先例;launch = `java -jar` equinox launcher `-data ~/.tmd-cli/lsp/jdt-ws/<repoKey>`;rootUri 向上找 pom.xml/build.gradle/.project 最近祖先,兜底工作区根)。
- 生命周期:惰性 spawn(首个语义请求);空闲 10 分钟或工作区无代码 tab → `lsp_stop`;崩溃标记未就绪,下次手势重试一次;java 首启索引期状态徽标「索引中」。
- 快捷键:插件贡献命令 `lsp.gotoDefinition`(F12)/`lsp.findReferences`(Shift+F12)经 kernel shortcuts 注册面;Escape 永不注册。
- 右键菜单:CM contextmenu 上挂「转到定义/查找引用」两项;server 未就绪时置灰。
- `src/plugins/index.ts` allPlugins +1 行。

### CM 扩展落点对齐(2026-09-19 复核 architecture/13)

`cmLsp.ts`(手势/hover/didOpen-didChange 同步)与 `peekWidget.tsx` 落 **`src/plugins/lsp/`** 经 `registerEditorExtension` 工厂注入(拆包红线:工厂体内只许动态 import `@codemirror/*`),**不**放 `src/kernel/lsp/`;kernel/lsp 只留 `lspClient.ts`(协议层)+ `lspRegistry.ts`(语言配置注册面)。跳转复用 `openFileAtLine`(search 插件同款跨插件 import 先例)。

## 验证

- Rust:cargo test(帧解析粘包/分包/跨 chunk、spawn/stop、假 server 往返)+ clippy -D warnings + fmt --check。
- 前端 vitest:JSON-RPC id 关联与超时、UTF-16 换算(CJK/emoji)、didChange 增量映射、发现链解析顺序。
- 桩目检(1421):`__TAURI_INTERNALS__` 桩 `lsp_*` 命令 + 假 hover/definition/references 响应,目检手势分流、peek 布局与跳转、Esc 关闭、未就绪置灰。
- 真机:tmd-cli 仓自身(TS 全套交互)+ Python 仓冒烟 + Java 仓 jdt 引导下载与首启冒烟。
- 门禁:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`;`npx react-doctor@latest -y` 100 分。

## 风险与边界

- jdt.ls 首启索引分钟级:显式「索引中」徽标,请求未就绪时提示而非假空;
- server 发现失败(机器无 node/JDK):该语言菜单置灰 + 首次手动触发 toast 说明,不做猜测兜底;
- 大仓 references 慢:peek loading + 可取消(`$/cancelRequest`);
- pyright 经 npx 首次拉取需网络与时间:引导文案注明首次延迟。
