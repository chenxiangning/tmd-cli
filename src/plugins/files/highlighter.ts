/**
 * highlight.js 高亮器 —— 轻量方案(无 wasm,直接 import 即用)。
 * 替代之前 shiki(打包 1.4 MB,性能开销大)。
 *
 * 默认引入常用语言子集,可按需扩展。
 */

import hljs from "highlight.js/lib/core";
import typescript from "highlight.js/lib/languages/typescript";
import javascript from "highlight.js/lib/languages/javascript";
import rust from "highlight.js/lib/languages/rust";
import python from "highlight.js/lib/languages/python";
import java from "highlight.js/lib/languages/java";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import toml from "highlight.js/lib/languages/ini";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";

hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("python", python);
hljs.registerLanguage("java", java);
hljs.registerLanguage("json", json);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("toml", toml);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("css", css);
hljs.registerLanguage("go", go);

/** 文件扩展 → highlight.js lang id。 */
export function extToLang(path: string): string | null {
  const ext = path.includes(".") ? path.split(".").pop()!.toLowerCase() : "";
  switch (ext) {
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
      return "javascript";
    case "rs":
      return "rust";
    case "py":
      return "python";
    case "java":
      return "java";
    case "json":
      return "json";
    case "md":
      return "markdown";
    case "toml":
      return "toml";
    case "xml":
    case "html":
      return "xml";
    case "yml":
    case "yaml":
      return "yaml";
    case "sh":
    case "bash":
      return "bash";
    case "css":
      return "css";
    case "go":
      return "go";
    default:
      return null;
  }
}

/** 同步高亮 — 返回 HTML 字符串;失败返回 null(消费方降级 <pre>)。 */
export function highlightSync(path: string, content: string): string | null {
  const lang = extToLang(path);
  if (!lang) return null;
  try {
    const result = hljs.highlight(content, { language: lang, ignoreIllegals: true });
    return `<pre class="hljs"><code>${result.value}</code></pre>`;
  } catch {
    return null;
  }
}
