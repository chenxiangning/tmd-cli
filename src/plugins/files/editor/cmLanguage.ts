/**
 * 扩展名 → CodeMirror 语言扩展(懒加载 + 缓存)。
 *
 * 照抄 codemoss codemirrorLanguageExtensions 的 switch + 动态 import 模式:
 * 语言包只在首次打开对应文件时才拉 chunk,主包不背任何语言语法体积。
 * 未命中返回空数组(纯文本编辑)。
 */

import type { Extension } from "@codemirror/state";

const extensionCache = new Map<string, Promise<Extension[]>>();

/** ts/tsx/js/jsx → javascript({typescript|jsx});其余按扩展名直查。 */
function loadByExt(ext: string): Promise<Extension[]> {
  switch (ext) {
    case "ts":
    case "mts":
    case "cts":
      return import("@codemirror/lang-javascript").then(({ javascript }) => [
        javascript({ typescript: true }),
      ]);
    case "tsx":
      return import("@codemirror/lang-javascript").then(({ javascript }) => [
        javascript({ typescript: true, jsx: true }),
      ]);
    case "js":
    case "mjs":
    case "cjs":
      return import("@codemirror/lang-javascript").then(({ javascript }) => [javascript()]);
    case "jsx":
      return import("@codemirror/lang-javascript").then(({ javascript }) => [
        javascript({ jsx: true }),
      ]);
    case "json":
      return import("@codemirror/lang-json").then(({ json }) => [json()]);
    case "html":
    case "htm":
    case "vue":
    case "svelte":
      return import("@codemirror/lang-html").then(({ html }) => [html()]);
    case "css":
    case "scss":
    case "less":
      return import("@codemirror/lang-css").then(({ css }) => [css()]);
    case "md":
    case "markdown":
    case "mdx":
      return import("@codemirror/lang-markdown").then(({ markdown }) => [markdown()]);
    case "py":
      return import("@codemirror/lang-python").then(({ python }) => [python()]);
    case "rs":
      return import("@codemirror/lang-rust").then(({ rust }) => [rust()]);
    case "xml":
    case "svg":
      return import("@codemirror/lang-xml").then(({ xml }) => [xml()]);
    case "yml":
    case "yaml":
      return import("@codemirror/lang-yaml").then(({ yaml }) => [yaml()]);
    default:
      return Promise.resolve([]);
  }
}

/** 按路径加载语言扩展;结果按语言键缓存,失败降级纯文本(不反复重试)。 */
export function loadCmLanguage(path: string): Promise<Extension[]> {
  const ext = path.includes(".") ? path.split(".").pop()!.toLowerCase() : "";
  if (!ext) return Promise.resolve([]);
  const cached = extensionCache.get(ext);
  if (cached) return cached;
  const pending = loadByExt(ext).catch(() => [] as Extension[]);
  extensionCache.set(ext, pending);
  return pending;
}
