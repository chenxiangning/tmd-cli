/**
 * CodeMirror 主题(纯主题定义,无组件)── 语法高亮直接吃应用主题的
 * --tmd-syntax-* token(theme 引擎随 preset 内联更新),明暗与配色和
 * 全应用严格一致;底色透明,融进编辑区背景。
 */

/* CodeMirror 重库动态加载(cmEditor 惰性分包的延伸;先例 loadCmLanguage)。
   Extension 为 type-only import,不引入运行时依赖。 */
import type { Extension } from "@codemirror/state";


let cached: { dark: boolean; exts: Extension[] } | null = null;

/** 编辑器 chrome 主题:透明底 + 应用 token;dark 影响默认兜底样式取向。
 *  异步加载(per-dark 缓存):CodeMirror 全家按需进 chunk,与编辑器拆包策略一致。 */
export async function loadCmTheme(dark: boolean): Promise<Extension[]> {
  if (cached?.dark === dark) return cached.exts;
  const [{ EditorView }, { HighlightStyle, syntaxHighlighting }, { tags: levTags }] = await Promise.all([
    import("@codemirror/view"),
    import("@codemirror/language"),
    import("@lezer/highlight"),
  ]);
  /** 语义 tag → --tmd-syntax-* token(与 Prism 代码块同一色板)。 */
  const syntaxHighlight = HighlightStyle.define([
    { tag: [levTags.keyword, levTags.modifier, levTags.atom, levTags.self, levTags.null], color: "var(--tmd-syntax-keyword)" },
    { tag: [levTags.string, levTags.special(levTags.string), levTags.regexp, levTags.escape], color: "var(--tmd-syntax-string)" },
    { tag: [levTags.comment, levTags.quote, levTags.meta], color: "var(--tmd-syntax-comment)" },
    { tag: [levTags.number, levTags.bool, levTags.integer, levTags.float], color: "var(--tmd-syntax-number)" },
    { tag: [levTags.operator, levTags.operatorKeyword, levTags.punctuation, levTags.separator, levTags.bracket], color: "var(--tmd-syntax-operator)" },
    { tag: [levTags.function(levTags.variableName), levTags.function(levTags.propertyName), levTags.definition(levTags.variableName), levTags.labelName], color: "var(--tmd-syntax-function)" },
    { tag: [levTags.typeName, levTags.className, levTags.namespace, levTags.macroName], color: "var(--tmd-syntax-type)" },
    { tag: [levTags.tagName, levTags.attributeName], color: "var(--tmd-syntax-tag)" },
    { tag: [levTags.propertyName, levTags.variableName, levTags.definition(levTags.propertyName)], color: "var(--tmd-fg)" },
    { tag: [levTags.heading, levTags.strong, levTags.emphasis], color: "var(--tmd-fg)", fontWeight: "600" },
    { tag: [levTags.link, levTags.url, levTags.monospace], color: "var(--tmd-syntax-string)" },
  ]);
  const exts = [
    EditorView.theme(
      {
        "&": {
          backgroundColor: "transparent",
          color: "var(--tmd-fg)",
          height: "100%",
          fontSize: "0.75rem",
        },
        ".cm-scroller": {
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          lineHeight: "1.6",
        },
        ".cm-content": { caretColor: "var(--tmd-accent)" },
        ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--tmd-accent)" },
        "&.cm-focused": { outline: "none" },
        ".cm-gutters": {
          backgroundColor: "transparent",
          color: "var(--tmd-fg-faint)",
          border: "none",
          borderRight: "1px solid var(--tmd-border)",
        },
        ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--tmd-fg) 5%, transparent)" },
        ".cm-activeLineGutter": {
          backgroundColor: "transparent",
          color: "var(--tmd-fg)",
        },
        ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
          backgroundColor: "color-mix(in srgb, var(--tmd-accent) 30%, transparent) !important",
        },
        ".cm-matchingBracket": {
          backgroundColor: "var(--tmd-bg-hover)",
          outline: "1px solid var(--tmd-border-strong)",
        },
        ".cm-foldPlaceholder": {
          backgroundColor: "var(--tmd-bg-hover)",
          border: "1px solid var(--tmd-border)",
          color: "var(--tmd-fg-muted)",
        },
        ".cm-tooltip": {
          backgroundColor: "var(--tmd-bg-elevated)",
          border: "1px solid var(--tmd-border)",
          color: "var(--tmd-fg)",
        },
        ".cm-searchMatch": {
          backgroundColor: "color-mix(in srgb, var(--tmd-syntax-number) 30%, transparent)",
        },
        ".cm-searchMatch-selected": {
          backgroundColor: "color-mix(in srgb, var(--tmd-syntax-number) 55%, transparent)",
        },
      },
      { dark },
    ),
    syntaxHighlighting(syntaxHighlight),
  ];
  cached = { dark, exts };
  return exts;
}
