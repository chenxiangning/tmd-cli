#!/usr/bin/env node
/**
 * 架构边界铁则检查 —— import 事实核验(见 docs/architecture/01-overview.md §2、
 * docs/review/2026-09-02-architecture.md R1/R3/R4)。
 *
 * - R1: src/kernel/** 不得 import 任何 plugins(@plugins/* 或相对路径)
 * - R3: @tauri-apps/* 的唯一 import 点是 src/kernel/ipc.ts
 * - R4: src/plugins/** 不得反向 import app-shell(@shell/* 或相对路径)
 *
 * 零依赖,Node 18+,跨平台(win/mac/linux 均可本地跑)。
 * 任何违规 → 退出码 1,CI 红。
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const EXTS = new Set([".ts", ".tsx"]);
const IMPORT_RE = /(?:import|export)[^'"]*from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

/** 递归收集 TS 源文件(跳 node_modules/dist 等产物目录)。 */
function collect(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) collect(path, out);
    else if (EXTS.has(extname(entry))) out.push(path);
  }
  return out;
}

/** 提取文件内全部静态/动态 import 的 specifier。 */
function importSpecifiers(file) {
  const content = readFileSync(file, "utf8");
  const specs = [];
  for (const match of content.matchAll(IMPORT_RE)) {
    specs.push(match[1] ?? match[2]);
  }
  return specs;
}

const violations = [];
const IPC_FILE = join("src", "kernel", "ipc.ts");

for (const file of collect("src")) {
  const inKernel = file.startsWith(join("src", "kernel"));
  const inPlugins = file.startsWith(join("src", "plugins"));
  for (const spec of importSpecifiers(file)) {
    // R3: @tauri-apps/* 只允许 ipc.ts
    if (spec.startsWith("@tauri-apps/") && file !== IPC_FILE) {
      violations.push(`R3 ${file} → "${spec}"(@tauri-apps/* 唯一通道是 src/kernel/ipc.ts)`);
    }
    // R1: kernel 不得 import plugins
    if (inKernel && (spec.startsWith("@plugins/") || spec.includes("/plugins/"))) {
      violations.push(`R1 ${file} → "${spec}"(kernel 不得 import plugins)`);
    }
    // R4: plugins 不得反向 import app-shell
    if (inPlugins && (spec.startsWith("@shell/") || spec.includes("/app-shell/"))) {
      violations.push(`R4 ${file} → "${spec}"(plugins 不得反向依赖 app-shell)`);
    }
  }
}

if (violations.length > 0) {
  console.error(`\n❌ 架构边界铁则违规(${violations.length} 条):`);
  for (const v of violations) console.error(`  ${v}`);
  process.exit(1);
}

console.log("✅ 架构边界铁则通过:R1 kernel↛plugins / R3 ipc 唯一通道 / R4 plugins↛app-shell。");
