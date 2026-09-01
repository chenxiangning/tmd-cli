#!/usr/bin/env node
/**
 * 文件规模铁则检查 —— 单文件 ≤500 行(见 docs/architecture/02-code-architecture.md)。
 *
 * - 扫描 src/ 与 src-tauri/src/ 下的 .ts/.tsx/.rs/.css
 * - 豁免:文件头(前 10 行)注释含 `file-size-exempt` 标记(仅限自动生成/vendored 文件)
 * - 任何违规 → 退出码 1,CI 红
 *
 * 零依赖,Node 18+,跨平台(win/mac/linux 均可本地跑)。
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const LIMIT = 500;
const ROOTS = ["src", "src-tauri/src"];
const EXTS = new Set([".ts", ".tsx", ".rs", ".css"]);
const EXEMPT_MARK = /file-size-exempt/;

/** 递归收集目标文件(跳 node_modules/target/dist 等产物目录)。 */
function collect(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "target" || entry === "dist" || entry === "gen") {
      continue;
    }
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      collect(path, out);
    } else if (EXTS.has(extname(entry))) {
      out.push(path);
    }
  }
  return out;
}

const violations = [];
const exempted = [];

for (const root of ROOTS) {
  for (const file of collect(root)) {
    const content = readFileSync(file, "utf8");
    const head = content.split("\n", 10).join("\n");
    if (EXEMPT_MARK.test(head)) {
      exempted.push(file);
      continue;
    }
    const lines = content.split("\n").length;
    if (lines > LIMIT) violations.push({ file, lines });
  }
}

if (exempted.length > 0) {
  console.log(`豁免 ${exempted.length} 个文件(file-size-exempt 标记):`);
  for (const f of exempted) console.log(`  - ${f}`);
}

if (violations.length > 0) {
  console.error(`\n❌ 文件规模铁则违规(>${LIMIT} 行):`);
  for (const v of violations.sort((a, b) => b.lines - a.lines)) {
    console.error(`  ${v.lines} 行  ${v.file}`);
  }
  console.error("\n请按 docs/architecture/02-code-architecture.md「文件规模铁则」拆分。");
  process.exit(1);
}

console.log(`✅ 文件规模铁则通过:全部受控文件 ≤${LIMIT} 行。`);
