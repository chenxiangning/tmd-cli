#!/usr/bin/env node
/**
 * post-build:裁剪 excalidraw 冗余语言包 chunk。
 *
 * excalidraw prod 包对 55 个 locale 各静态映射一个 dynamic import,vite build
 * 会把全部语言 chunk 拷进 dist/assets;但界面语言是闭合枚举 UiLanguage =
 * "zh" | "en" | "ja"(EditorShared.excalidrawLangCode),langCode 永远只可能是
 * zh-CN / ja-JP / en 三值,其余 52 个 chunk 全量携带纯属包体死重。
 * 语言名与包内哈希基名取自 node_modules 的 locales 目录,与 dist 输出
 * (assetFileNames `[name]-[hash].js`,name = 去扩展名基名)前缀匹配。
 */
import { readdir, stat, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const assetsDir = fileURLToPath(new URL("../dist/assets/", import.meta.url));
const localesDir = fileURLToPath(
  new URL("../node_modules/@excalidraw/excalidraw/dist/prod/locales/", import.meta.url),
);
const KEEP = new Set(["zh-CN", "ja-JP", "en"]);

let localeBases;
try {
  localeBases = (await readdir(localesDir)).filter((n) => n.endsWith(".js")).map((n) => n.slice(0, -3));
} catch {
  console.warn(`[prune-excalidraw-locales] ${localesDir} 不存在,跳过`);
  process.exit(0);
}
const prunePrefixes = localeBases
  .filter((base) => !KEEP.has(base.split("-").slice(0, localePartCount(base)).join("-")))
  .map((base) => base + "-");

/** 基名形如 `zh-CN-LNUGB5OW`:语言码 2 段(en 无国家段),包哈希恒为末段。 */
function localePartCount(base) {
  return base.startsWith("en-") ? 1 : 2;
}

let entries;
try {
  entries = await readdir(assetsDir);
} catch {
  console.warn(`[prune-excalidraw-locales] ${assetsDir} 不存在,跳过`);
  process.exit(0);
}

let removed = 0;
let freedBytes = 0;
for (const name of entries) {
  if (!prunePrefixes.some((p) => name.startsWith(p))) continue;
  const file = join(assetsDir, name);
  freedBytes += (await stat(file)).size;
  await unlink(file);
  removed++;
}
console.log(`[prune-excalidraw-locales] 删除 ${removed} 个语言 chunk,释放 ${(freedBytes / 1024).toFixed(0)}KB`);
