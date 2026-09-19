# 代码符号跳转与引用(cmd/ctrl+click)调研 — yn 实证与多语言语义路线

- 日期:2026-09-19
- 状态:调研底稿(未拍板,不排期;后续做 ts/js/java/python 语义跳转时以此为起点)

## 背景与结论

用户在 yn 里见到:cmd/ctrl+左键点变量/方法/引用 → 弹出引用 peek 浮窗(monaco ReferencesWidget,VS Code 同款 UI)。该能力未列入 2026-09-18 yn 复刻 spec 的三项范围(md 渲染提速 / 代码渲染 / 全文搜索+快开),属范围外遗漏识别。本文回答三件事:yn 这能力的真实来源、tmd-cli(CM6 栈)复刻的路线与成本、未来多语言语义跳转的推荐架构。

结论先行:

1. yn 的引用能力 = **monaco-editor 白送,yn 自己零行代码**;同文件开箱即得,跨文件残缺(仅覆盖已打开 model,无项目/tsconfig 语义)。
2. tmd-cli 复刻路线:**用户拍板(2026-09-19):不做字面引用,一步到位走语义 —— 统一 LSP 通道**(Rust 通用 stdio JSON-RPC 原语 + `codemirror-languageserver` 前端适配),ts/js/python/java 各接一个 LSP server,不做每语言专用协议。M0 字面方案被否决,下文留档仅作对比与兜底讨论。

## 一、yn 侧实证(clone purocean/yn @ /tmp/yn-analysis,2026-09-19)

- 编辑器 = monaco-editor ^0.49.0(`package.json:142`),AMD 全量加载 `vs/editor/editor.main`(`MonacoEditor.vue` 的 `onGotAmdLoader` → `require(['vs/editor/editor.main'], initMonaco)`)。
- 全仓 grep 无 `registerReferenceProvider` / `DefinitionProvider` / `typescriptDefaults` 配置 —— 引用/定义智能完全来自 `editor.main` 内置的 `vs/language/typescript` worker(完整 TypeScript 编译器跑 Web Worker)与内置手势:cmd/ctrl+click = gotoDefinition,Shift+F12 = peek references(ReferencesWidget,即截图浮窗)。
- 能力边界:worker 只编译编辑器里打开的 model(`createModel` 缓存不释放,monaco 默认 eager model sync)→ **同文件**引用/定义开箱即得;**跨文件**只对已打开文件生效;无 tsconfig/项目加载。yn 的「代码引用」不是完整 IDE 能力。
- 推论:复刻 yn 不必复刻它的实现方式 —— tmd-cli 若走语义路线应直接上 LSP,体验上限高于 yn。

## 二、tmd-cli 现状与已有资产

- 编辑器 = CodeMirror 6(`src/kernel/cmEditor/FileCodeEditorImpl.tsx`;baseExts 已含 `@codemirror/search`;语言映射 `cmLanguage.ts`)。
- 缺三样:① 点击手势(CM6 无内置 gotoDefinition 鼠标手势,需 `domEventHandlers(mousedown)` + (mod||ctrl) + `wordAt(pos)`);② peek 浮窗(需自绘,即 monaco ReferencesWidget 对应物);③ 语义引擎(零)。
- 已有可复用资产:`fs_search`(Rust 即时字面搜索,3MB 闸/二进制嗅探/命中 cap/3s 预算,search 插件在用)—— 字面引用路线的引擎现成。

## 三、路线对比

### M0 字面引用(推荐起步)

- 做法:cmd/ctrl+click 取 word → `fsSearch` 全仓字面搜索 → 命中按词边界过滤 → 自绘浮窗(文件+行+上下文片段,点击 `openFileAtLine` 跳转)。
- 成本:小(手势 + 浮窗两个改动面,引擎已有);全语言通吃。
- 缺陷:非语义(注释/字符串/同名标识符入列),无定义/引用之分。

### M1 统一 LSP 通道(语义需求落地时的标准架构)

- Rust 侧通用原语:`lsp_spawn(rootUri, serverCmd)` / `lsp_request(method, params)` —— stdio JSON-RPC(Content-Length framing)转发。LSP 是通用协议,进 kernel 合规(同 `sqliteQuery` 先例,无单插件语义;server 发现/安装引导等语言知识留插件侧)。
- 前端:`codemirror-languageserver` v1.22.1(BSD-3-Clause,CM6 生态;注:`@codemirror/languageserver` 不存在,npm 实测 404)做 LSP 协议适配;peek 浮窗复用 M0 自绘组件。
- server 选型:
  - TS/JS → `typescript-language-server`(MIT,把 tsserver 包成 LSP;直接讲 tsserver 私有协议没必要);
  - Python → `pyright`(MIT,node 侧,LSP 原生,npx 可跑,发现最容易);
  - Java → `eclipse.jdt.ls`(EPL-2.0,需 JDK 17+,首启全仓索引分钟级 —— 重,风险项,放最后)。
- 每语言 = 一条「发现+安装引导」配置(工作区 `node_modules/.bin` → 全局 → 引导安装),server 生命周期按 workspace+language 管理。

### 已否决

- 整包换 monaco 编辑器:为白送能力换整个编辑器栈,不值;
- 每语言专用协议直连(tsserver/pyright/jdt 各一套):重复建设,LSP 是行业收敛点;
- Tree-sitter/WASM 符号索引:只有大纲/高亮级别,不是真引用,不解决问题;
- 编译器塞 Web Worker:只有 TS 有编译器可塞,java/python 无对应物,路线不通用。

## 四、建议路线图

- M0(半天~1 天):字面引用浮窗,覆盖截图体验九成,零新依赖。
- M1(2~4 天):LSP 通用通道 + TS/JS 先行(tsserver 发现最容易:工作区 node_modules)。
- M2(每语言 0.5~1 天):pyright → jdt.ls(重,单独评估)。
- 触发条件:M1/M2 待用户对语义级跳转提出真实需求再启动;M0 可先落地作日常基线。

## 五、风险清单

- jdt.ls 依赖 JDK + 长首启索引,体验差 → java 放最后,显式「语言服务未就绪」降级提示;
- LSP server 发现失败率(用户机器无 node/JDK)→ 语义能力必须保 M0 字面兜底;
- Windows spawn 路径/引号差异 → 走既有 Windows 平台契约(architecture/04);
- 大仓 references 响应延迟 → LSP 请求带取消;浮窗 loading 态。

(调研基线:yn shallow clone @ /tmp/yn-analysis,2026-09-19;monaco 构成与 `codemirror-languageserver` 事实均实测。)
