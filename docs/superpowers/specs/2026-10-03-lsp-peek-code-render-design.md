# LSP 语义弹窗 code 渲染打磨(peek 配色根因修复 + 符号区间共存)

日期:2026-10-03
状态:已评审通过(用户确认取「完整打磨」档)

## 背景与目标

LSP 引用/定义 peek 弹窗(左 = 源码预览,右 = 引用列表)与 hover 卡的代码看起来是「一片白」:
`peekWidget.ts` 其实一直在调 `highlightLine`(Prism),但全仓的 Prism token → 颜色 CSS 映射
只有 markdown 代码块(`.fvp-file-markdown-codeblock`)与结构化预览(`.fvp-structured-preview`)
两处,lsp 域没有任何 `.token.*` 规则,token span 全部以默认前景色渲染。另有两处干脆是纯文本:

1. 当前行符号区间:为避开「对已高亮 HTML 做列切分」的错位问题,现实现直接放弃高亮、
   三段 `escapeHtml` 拼接 + `.lsp-peek-sym` 底色(`peekWidget.ts`);
2. 右列表行文本回填:纯 `textContent`(`peekList.ts`),无任何 code 渲染。

目标:peek 预览、当前行、右列表行、hover 代码块四处全部获得真正的语法渲染,
当前行符号底色与 token 颜色共存;配色统一吃 `--tmd-syntax-*`(与 CodeMirror
编辑器 / markdown 代码块同一色板,随主题 preset 联动)。

## 方案取舍

**选定:补 lsp 域 token 映射 + 纯字符串符号区间包裹。**

1. **token 配色(根因)**:新建 `src/plugins/lsp/lsp-code.css`,给 `.lsp-peek` /
   `.lsp-hover` 作用域补 Prism token → `--tmd-syntax-*` 映射(照抄 markdown
   代码块的映射关系,换作用域),`index.tsx` 挂载。lsp.css 已 292/300 行,新规则
   必须独立分片。
2. **符号区间包裹 `symRange.ts`**:`highlightLine` 整行高亮后,对产物 HTML 做
   一次线性扫描,按 UTF-16 偏移把 `[start, end)` 的解码文本包进
   `<span class="lsp-peek-sym">`;边界落在 token 内部时闭栈拆 token 再重开,
   嵌套与转义实体(`&lt;` 等 = 1 个解码字符)均正确。纯字符串变换,node 测试免 DOM。
   约束依赖了 `sanitizePrismHtml` 的产出保证:产物只有 `<span class="token …">`
   与转义文本,无其他标签形态。
3. **右列表行**:`peekList.ts` 回填改 `wrapSymRange(highlightLine(text, lang), …)`;
   行文本先 trim,符号偏移按「去头空白量」左移校正;`endChar == null`(跨行符号)
   取行尾。语言解析 `prismLangOf` 自 `peekWidget.ts` 抽 `peekLang.ts` 共享
   (peekWidget 已 import peekList,反向 import 成环)。

**否决:三段分别 `highlightLine` 拼接**(现实现的改良版)。实现最简,但符号边界把
字符串/注释/token 拆开各自分词,跨界必错(如 `getBy` + `Id(id));` 两段独立分词)。

**否决:预览升级 CodeMirror 实例**。重;`peekWidget.ts` 文件头已定调「纯文本预览
是九成价值;若需要行内编辑再升级为 CM 实例」,本次诉求只是显色。

**否决:全局裸 `.token.*` 规则**。会波及所有 Prism 消费面的现有作用域约定
(各面自管配色),超出本次范围。

## 交付物

| 文件 | 变更 |
|---|---|
| `src/plugins/lsp/lsp-code.css`(新) | `.lsp-peek` / `.lsp-hover` 作用域 Prism token 映射;列表行 code 透明度 0.65 → 0.75(上色后 0.65 发闷) |
| `src/plugins/lsp/symRange.ts`(新) | `wrapSymRange(html, start, end)` 纯函数 |
| `src/plugins/lsp/symRange.test.ts`(新) | 守卫 / 纯文本 / token 内拆分 / 实体 / Infinity / 越界 |
| `src/plugins/lsp/peekLang.ts`(新) | `PRISM_LANG_BY_EXT` + `prismLangOf`(自 peekWidget 平移) |
| `src/plugins/lsp/peekWidget.ts` | 删本地表与 escapeHtml,当前行改 `wrapSymRange(highlightLine(…))` |
| `src/plugins/lsp/peekList.ts` | 回填改 code 渲染,trim 偏移校正 |
| `src/plugins/lsp/peekList.test.ts` | FakeEl `textContent` 升级为「strip 标签 + 解实体」派生;补符号区间断言 |
| `src/plugins/lsp/index.tsx` | 挂 `lsp-code.css` |

## 验证

1. `pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build` 全绿;
2. `pnpm tauri:dev` 真实窗口目检:peek 预览/当前行/右列表行 token 显色、符号底色压在
   token 颜色上;hover 卡代码块同步显色;亮/暗主题各看一眼;
3. 收口 `npx react-doctor@latest -y` 得分 100。
