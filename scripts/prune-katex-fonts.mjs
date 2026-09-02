#!/usr/bin/env node
/**
 * post-build:裁剪 KaTeX 冗余字体格式。
 *
 * katex 的 css 对每款字体同时引用 woff2/woff/ttf 三种格式,vite build 会全量
 * 拷贝进 dist/assets;但目标 webview(macOS WKWebView / Windows WebView2)
 * 都支持 woff2,woff/ttf 是纯增包体的历史降级格式,构建后直接删除(woff2 保留)。
 */
import { readdir, stat, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const assetsDir = fileURLToPath(new URL("../dist/assets/", import.meta.url));
const PRUNE_RE = /^KaTeX_.*\.(woff|ttf)$/;

let entries;
try {
  entries = await readdir(assetsDir);
} catch {
  console.warn(`[prune-katex-fonts] ${assetsDir} 不存在,跳过`);
  process.exit(0);
}

let removed = 0;
let freedBytes = 0;
for (const name of entries) {
  if (!PRUNE_RE.test(name)) continue;
  const file = join(assetsDir, name);
  freedBytes += (await stat(file)).size;
  await unlink(file);
  removed++;
}

console.log(
  `[prune-katex-fonts] 删除 ${removed} 个冗余字体,省 ${(freedBytes / 1024 / 1024).toFixed(1)} MB(woff2 已保留)`,
);
