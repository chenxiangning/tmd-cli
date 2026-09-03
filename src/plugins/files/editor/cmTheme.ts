/**
 * CodeMirror 主题(纯主题定义,无组件)── 语法高亮直接吃应用主题的
 * --tmd-syntax-* token(theme 引擎随 preset 内联更新),明暗与配色和
 * 全应用严格一致;底色透明,融进编辑区背景。
 */

import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as levTags } from "@lezer/highlight";

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

/** 编辑器 chrome 主题:透明底 + 应用 token;dark 影响默认兜底样式取向。 */
export function cmEditorTheme(dark: boolean) {
  return [
    EditorView.theme(
      {
        "&": {
          backgroundColor: "transparent",
          color: "var(--tmd-fg)",
          height: "100%",
          fontSize: "12px",
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
}
