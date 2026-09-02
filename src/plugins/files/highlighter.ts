/**
 * highlight.js 高亮器 —— 轻量方案(无 wasm,直接 import 即用)。
 * 替代之前 shiki(打包 1.4 MB,性能开销大)。
 *
 * 体积较大,消费方(files/index.tsx)用动态 import 懒加载本模块;
 * 扩展名→语言映射在 ./highlightLangs(纯函数,不拉 hljs)。
 *
 * 默认引入常用语言子集,可按需扩展。
 */

import { extToLang } from "./highlightLangs";

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

/** 超过该体积不做高亮:hljs 在大文件上是 O(n) 但常数大,会长任务阻塞 UI。 */
const HIGHLIGHT_MAX_CHARS = 256 * 1024;

/** 同步高亮 — 返回 HTML 字符串;失败/超阈值返回 null(消费方降级 <pre>)。 */
export function highlightSync(path: string, content: string): string | null {
  const lang = extToLang(path);
  if (!lang) return null;
  /* 大文件直接降级 <pre> 直渲,保住滚动流畅度 */
  if (content.length > HIGHLIGHT_MAX_CHARS) return null;
  try {
    const result = hljs.highlight(content, { language: lang, ignoreIllegals: true });
    return `<pre class="hljs"><code>${result.value}</code></pre>`;
  } catch {
    return null;
  }
}
