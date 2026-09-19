# yn(Yank Note)能力复刻:md 渲染提速 + 代码渲染 + 全文搜索/快开 — 设计

- 日期:2026-09-18
- 状态:已定稿(实施中)
- 关联调研:yn 渲染管线与代码索引两份调研报告(会话产物,结论已沉淀本文)

## 背景与目标

用户认可 yn(Electron+Vue3+markdown-it,AGPL-3.0)的三项能力:md 渲染速度、代码渲染、代码索引;要求在 tmd-cli(React19+Tauri2,MIT)中复刻,加强现有插件。

tmd-cli 现状(tmdcli-md-current-report):
- md 预览 = react-markdown 全管线(remark-gfm/math → rehype-raw → rehype-sanitize → katex),功能完整但解析重(remark AST + hast + React elements 三层);
- 代码查看 = @uiw/react-codemirror,仅 10 个语言包,无编辑器内查找替换(@codemirror/search 未装);
- 全文搜索 / 文件名快开:完全没有(最大能力空白)。

目标:
1. md 渲染:常规块走 markdown-it 单遍 HTML 快路径(yn 同源方案),mermaid/数学/raw HTML 块保留现 react-markdown 富路径;
2. 代码渲染:CM 语言包扩容 + 编辑器内 ⌘F 查找替换(@codemirror/search);
3. 代码索引:Rust `fs_search` 通用原语 + 新 search 插件(⇧⌘F 全文搜索面板 + ⌘P 文件名快开),命中跳文件定位行。

## 方案取舍

### 取舍一:直接复刻 yn 代码 vs 照抄逻辑(用户明确提问)

**选定:照抄逻辑(行为级复刻),绝不复制 yn 源码。**

- 许可证:yn 是 AGPL-3.0,tmd-cli 是 MIT。逐行复制会让 tmd-cli 成为 AGPL 派生作品(分发/网络服务均须开源整体),不可接受。
- 技术栈:yn 是 Vue3 SFC + Electron 主进程,UI 与进程模型代码本就无法直接复用。
- 底层库本身多为 MIT,直接以依赖引入合法且更省:markdown-it ^14(MIT)、prismjs(已在依赖表)、@codemirror/* 官方包。yn 唯一公有领域资产(lib_fts 模糊匹配)也只有百行,自写 40 行打分器更干净。
- 被否决方案:直接拷贝 yn 源码目录 —— AGPL 传染 + Vue/React 不兼容,双杀。

### 取舍二:md 快路径 —— 全量换 markdown-it vs 双路径

**选定:块级双路径。** `BlockMarkdown`(useMarkdownComponents.tsx)内部先分类:
- 富块(`\`\`\`mermaid|math|katex` 栅栏、`$` 数学、`<[a-zA-Z/]` raw HTML)→ 现有 react-markdown 管线原样(mermaid/数学组件、rehype-raw+sanitize 全保留);
- 常规块 → markdown-it(html:false)单遍出 HTML 字符串,`dangerouslySetInnerHTML` 直塞。

理由:
- html:false 时 markdown-it 转义一切原文,快路径零 XSS 面,不需要 sanitize(yn 用 html:true+iframe 沙箱+tmd-cli 不需要的复杂度);
- mermaid/数学/raw HTML 占比极小且已有成熟 React 组件,强行字符串化反而要重写一遍(重写 = 新 bug 面);
- 被 否决:①全量换 markdown-it —— mermaid/数学/markdown 组件(表格滚动缓存/重块懒揭示/marks 联动)全要重做,风险不成比例;②维持 react-markdown —— 用户明确要 yn 的速度,remark→hast→React 三层结构在大文档上是数量级差距。

速度要点(yn 同款,自实现):渲染即字符串拼接(prism highlightLine 已有缓存)、块级 memo 不变、代码块复制按钮/链接/图片点击改容器级事件委托(yn 的 hook 代理同思路)。CSS 表格横滚用容器 class 兜底,不占 React 组件。

### 取舍三:全文搜索 —— 持久索引 vs rg 式即时搜索

**选定:Rust `fs_search` 即时搜索,不做持久索引。**
- yn 自己的「索引」也只是 md 结构索引(链接/标签),全文搜索完全外包 ripgrep;真正让用户感知「代码索引强」的是 rg 速度 + 结果跳转体验。
- tmd-cli 已有 ignore crate(ripgrep 同源 gitignore 引擎,fs_walk.rs 在用),Rust 侧 walk+逐行字面匹配(ASCII 大小写可关)在万级文件仓是毫秒~亚秒级,持久索引/倒排/Worker(yn 方案)是为「链接图谱」服务的,YAGNI。
- 被 否决:①持久索引(Dexie/IndexedDB + worker)—— 复杂度大、失效路径多,收益只在超大仓二跳搜索;②前端逐文件 fs_read_file 搜索 —— 每文件一次 IPC,慢一个数量级;③正则搜索 —— 不引入 regex crate,v1 字面匹配覆盖绝大多数用法(需要时二期加)。
- 护栏(照 yn 行为):单文件 >3MB 跳过、首 8KB 含 \0 判二进制跳过、总命中 cap(默认 2000)+ 单文件 cap(100)、walk 时间预算 3s、取消 = 前端丢弃结果(搜索即发即用,无长驻进程)。

### 取舍四:快开数据源

`fs_walk_files`(已有,ignore 语义与 @ 补全一致)取 5000 条 + 前端自写模糊打分(subsequence + 词首/连续加成)。否决:引入 fuzzy 依赖库 —— 40 行内解决不引库。

## 变更清单

- 新增 `src/plugins/files/markdown/fastPath.ts`:markdown-it 实例(html:false/linkify)+ 任务列表规则 + fence/链接/图片 renderer 规则(prism highlightLine、本地图片解析、外链/内链/锚点 data 属性)+ 富块分类器。
- 改 `src/plugins/files/markdown/useMarkdownComponents.tsx`:`BlockMarkdown` 双路径 + 快路径容器事件委托(a/img/copy)。
- 改 `src/kernel/cmEditor/cmLanguage.ts`:扩语言映射(go/java/c/cpp 系/php/sql 官方包 + ruby/shell/swift/toml/r 经 legacy-modes)。裁剪:@codemirror/lang-kotlin 与 lang-ruby 官方包不存在(ruby 走 legacy-modes),dart 无兼容包(legacy clike 类型不合)——两者 v1 纯文本,官方包出现再补。
- 改 `src/kernel/cmEditor/FileCodeEditorImpl.tsx`(+壳 props):`@codemirror/search`(Mod-F openSearchPanel)+ `revealLine` 一次性定位 effect;新增依赖 @codemirror/lang-{go,java,cpp,php,ruby,sql,kotlin}、@codemirror/legacy-modes、@codemirror/search。
- 新增 `src-tauri/src/fs_search.rs` + `commands_fs.rs` 命令 `fs_search`;`src/kernel/ipc.ts` 加 `fsSearch` 包装。
- 改 `src/plugins/files/openFile.ts`:`openFileAtLine(path, line)`(tab payload 带 line,FileTabContent 透传);md 文件 v1 不做行定位(预览滚动定位需动在途文件,有意裁剪,待 marks 会话收口后补)。
- 新增 `src/plugins/search/`(index.tsx 注册命令 + 面板 + 快开 + fuzzy + locale),`src/plugins/index.ts` allPlugins +1 行。
- 依赖新增均为处理器/官方编辑器扩展包,非框架/状态库/UI 组件库。

## 验证

- 单元:vitest — 快路径渲染快照断言(标题/表格/代码高亮/任务列表/链接 data 属性/富块分类);fuzzy 打分;openFileAtLine payload。
- Rust:cargo test(新增 fs_search 集成测试:命中/大小写/二进制跳过/cap)+ clippy + fmt。
- 门禁:pnpm typecheck && vitest run && check:arch-boundary && check:file-size && build;cargo 侧同上;npx react-doctor -y 100 分。
- 目检:1421 桩(dev server)开真实客户端:md 快路径渲染对照富路径、⇧⌘F 搜索跳转行定位、⌘P 快开。
