/**
 * i18n 键全量 diff 检查 —— t() 字面量键 × en/ja 词典全量比对(spec 机制 3 的脚本化落点)。
 *
 * 检查三件事:
 * 1. 缺键(硬失败,exit 1):源码 t("字面量") 的键在 en 或 ja 词典(全局合并:kernel
 *    locales + 各插件 locales)中不存在 —— 运行时回落中文,en/ja 用户看到中文。
 * 2. en↔ja 不对称(硬失败):同一语言面一边有一边无的键。
 * 3. 死键(仅告警):词典有、源码 t() 字面量未引用的键 —— 动态键(t(field),如设置
 *    标签/CLI 配置说明)会误报,只作人工核对清单,不影响退出码。
 *
 * 用法:node scripts/check-i18n-keys.mjs(或 pnpm check:i18n-keys)。
 * 约定:键=中文源串;zh 恒等无词典,不参与比对。插值占位符 {n} 属键的一部分。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const SRC = join(ROOT, "src");

/** 递归收集目录下指定后缀文件。 */
function walk(dir, exts, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, exts, out);
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

/** 提取词典文件里作为对象键的字符串字面量(双引号/单引号)。 */
function extractDictKeys(text) {
  const keys = new Set();
  const re = /(?:^|[,{\n])\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)')\s*:/g;
  for (const m of text.matchAll(re)) keys.add(m[1] ?? m[2]);
  return keys;
}

/** 收录词典文件,返回 [lang, keys] 列表;兼容三形态:
 *  kernel/locales/<lang>/<domain>.ts、plugins/<id>/locales/<lang>.ts(分文件)、
 *  plugins/<id>/locales.ts(单文件内联 MESSAGES_EN/MESSAGES_JA 两段)。 */
function collectDict(file) {
  const rel = relative(ROOT, file).replaceAll("\\", "/");
  const text = readFileSync(file, "utf8");
  if (/\/locales\/(en|ja)(\/[^/]+)?\.ts$/.test(rel)) {
    const lang = /\/locales\/en([/.]|$)/.test(rel) ? "en" : "ja";
    return [[lang, extractDictKeys(text)]];
  }
  if (/\/locales\.ts$/.test(rel)) {
    // 单文件双词典:按 MESSAGES_JA 段边界一切两半(手写扁平词典,足够可靠)。
    const idx = text.search(/\bMESSAGES_JA\b|\bJA_MESSAGES\b/);
    const enPart = idx === -1 ? text : text.slice(0, idx);
    const jaPart = idx === -1 ? "" : text.slice(idx);
    return [
      ["en", extractDictKeys(enPart)],
      ["ja", extractDictKeys(jaPart)],
    ];
  }
  return [];
}

const allFiles = walk(SRC, [".ts", ".tsx"]);
const dictFiles = allFiles.filter(
  (f) =>
    (/\/locales\/(en|ja)(\/[^/]+)?\.ts$/.test(f) && !/\/index\.ts$/.test(f)) ||
    /\/locales\.ts$/.test(f),
);
const sourceFiles = allFiles.filter(
  (f) => !f.includes("/locales") && !/\.test\.[jt]sx?$/.test(f),
);

const dicts = { en: new Map(), ja: new Map() }; // lang -> file -> Set<key>
for (const f of dictFiles) {
  for (const [lang, keys] of collectDict(f)) {
    if (keys.size) dicts[lang].set(relative(ROOT, f), keys);
  }
}
/** 提取源码里 t("字面量") 的键(动态键 t(field) 无法静态提取,不在比对面)。 */
function extractUsedKeys(file) {
  const text = readFileSync(file, "utf8");
  const keys = new Set();
  const re = /\bt\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)')/g;
  for (const m of text.matchAll(re)) keys.add(m[1] ?? m[2]);
  return keys;
}

const used = new Map(); // file -> Set<key>
for (const f of sourceFiles) {
  const keys = extractUsedKeys(f);
  if (keys.size) used.set(relative(ROOT, f), keys);
}

const defined = {
  en: new Set(dicts.en.values().flatMap((s) => [...s])),
  ja: new Set(dicts.ja.values().flatMap((s) => [...s])),
};
const usedAll = new Set([...used.values()].flatMap((s) => [...s]));

const missing = { en: [], ja: [] };
for (const [file, keys] of used) {
  for (const key of keys) {
    if (!defined.en.has(key)) missing.en.push({ file, key });
    if (!defined.ja.has(key)) missing.ja.push({ file, key });
  }
}
const asym = {
  enOnly: [...defined.en].filter((k) => !defined.ja.has(k)),
  jaOnly: [...defined.ja].filter((k) => !defined.en.has(k)),
};
const dead = { en: [], ja: [] };
for (const [file, keys] of dicts.en) {
  const d = [...keys].filter((k) => !usedAll.has(k));
  if (d.length) dead.en.push({ file, keys: d });
}
for (const [file, keys] of dicts.ja) {
  const d = [...keys].filter((k) => !usedAll.has(k));
  if (d.length) dead.ja.push({ file, keys: d });
}

const fmt = (list) =>
  [...new Set(list.map((x) => x.key))]
    .sort()
    .map((k) => {
      const where = list.filter((x) => x.key === k).map((x) => x.file).join(", ");
      return `    "${k}"  (${where})`;
    })
    .join("\n");

let fail = false;
for (const lang of ["en", "ja"]) {
  if (missing[lang].length) {
    fail = true;
    console.error(`[缺键][${lang}] ${missing[lang].length} 处 t() 字面量键无词典(运行时回落中文):`);
    console.error(fmt(missing[lang]));
  }
}
if (asym.enOnly.length || asym.jaOnly.length) {
  fail = true;
  console.error(`[不对称] en↔ja 词典键不一致:`);
  if (asym.enOnly.length) console.error(`  仅 en 有 ${asym.enOnly.length} 键:\n${asym.enOnly.map((k) => `    "${k}"`).join("\n")}`);
  if (asym.jaOnly.length) console.error(`  仅 ja 有 ${asym.jaOnly.length} 键:\n${asym.jaOnly.map((k) => `    "${k}"`).join("\n")}`);
}
if (dead.en.length || dead.ja.length) {
  const n = dead.en.reduce((a, x) => a + x.keys.length, 0) + dead.ja.reduce((a, x) => a + x.keys.length, 0);
  console.warn(`[死键·告警] 词典有而 t() 字面量未引用 ${n} 键(动态键会误报,仅作人工核对,不计失败):`);
  for (const { file, keys } of [...dead.en, ...dead.ja]) console.warn(`  ${file}: ${keys.length} 键`);
}

const usedCount = usedAll.size;
const dictCount = Math.max(defined.en.size, defined.ja.size);
if (!fail && !dead.en.length && !dead.ja.length) {
  console.log(`i18n 键比对通过:t() 字面量 ${usedCount} 键,en/ja 词典各 ${defined.en.size}/${defined.ja.size} 键,零缺键零死键。`);
} else if (!fail) {
  console.log(`i18n 键比对:缺键 0、不对称 0(死键告警见上);t() 字面量 ${usedCount} 键,词典 ${dictCount} 键。`);
}
process.exit(fail ? 1 : 0);
