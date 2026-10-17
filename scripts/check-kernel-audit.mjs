#!/usr/bin/env node
/**
 * kernel 分区盘点 —— 产出「文件 × 行数 × 引用方」清单,供 0.3.9 kernel 分区盘点用。
 *
 * - 扫描 src/kernel/ 下 .ts/.tsx,统计行数与引用方(仓内谁 import 了它)
 * - 标签人工维护在 scripts/kernel-audit.json:{ "相对路径": { "tag": "...", "note": "..." } }
 *   tag 取值:host(宿主机制)/ contract(跨插件契约)/ move(应迁出)/ pending(待审,缺省)
 * - `--json` 输出完整清单;标签校验无条件执行(标签非法/指向不存在文件即红);
 *   `--check` 额外执行迁出红线:tag=move 的文件仍被 kernel 内其他文件引用 → 红
 *   (move 是「迁移完成声明」,须与消除 kernel 内引用同一提交;未迁完保持 pending)
 *
 * 扫描范围 src/(仓内引用方);零依赖,Node 18+。先盘点再定数字,脚本只产数据,判定人工。
 */

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve, dirname, posix } from "node:path";

const KERNEL = "src/kernel";
const SRC = "src";
const LABELS_FILE = "scripts/kernel-audit.json";
const TAGS = new Set(["host", "contract", "move"]);
const EXTS = [".ts", ".tsx"];

function collect(dir, exts, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "target" || entry === "gen") continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) collect(p, exts, out);
    else if (exts.some((e) => entry.endsWith(e))) out.push(p);
  }
  return out;
}

/** 解析 import 说明符到仓内文件(仅 .ts/.tsx,目录则试 index)。 */
function resolveSpec(spec, importer) {
  const candidates = [];
  if (spec.startsWith("@kernel/")) {
    const base = join(SRC, "kernel", spec.slice("@kernel/".length));
    candidates.push(base);
  } else if (spec.startsWith("./") || spec.startsWith("../")) {
    candidates.push(resolve(dirname(importer), spec));
  } else {
    return null;
  }
  const out = [];
  for (const c of candidates) {
    out.push(c.replaceAll("\\", "/"));
    for (const e of EXTS) out.push(c + e);
    for (const e of EXTS) out.push(posix.join(c.replaceAll("\\", "/"), "index" + e));
  }
  // resolve() 产绝对路径,而 kernelSet/引用方清单全用 cwd 相对路径——
  // 不归一的话所有相对导入边都会静默失配(只认得 @kernel 别名)。
  for (const c of out) if (existsSync(c)) return relative(process.cwd(), c).replaceAll("\\", "/");
  return null;
}

const kernelFiles = collect(KERNEL, EXTS).map((p) => p.replaceAll("\\", "/"));
const kernelSet = new Set(kernelFiles);
const allSrc = collect(SRC, [".ts", ".tsx"]);

const lines = new Map(kernelFiles.map((f) => {
  const c = readFileSync(f, "utf8");
  return [f, c.split("\n").length - (c.endsWith("\n") ? 1 : 0)];
}));
const referencedBy = new Map(kernelFiles.map((f) => [f, new Set()]));
const kernelInternalRefs = new Map(kernelFiles.map((f) => [f, new Set()]));

// 副作用导入(import "x")与 vi.mock("@kernel/x") 同样是真实引用边,必须入账,
// 否则 boot 垫片显示 0 引用、只剩测试 mock 的文件会骗过 move 红线。
const IMPORT_RE = /from\s+["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|import\s+["']([^"']+)["']|[mM]ock\s*\(\s*["']([^"']+)["']/g;
for (const f of allSrc) {
  const src = readFileSync(f, "utf8");
  const isKernel = f.replaceAll("\\", "/").startsWith(KERNEL + "/");
  for (const m of src.matchAll(IMPORT_RE)) {
    const spec = m[1] ?? m[2] ?? m[3] ?? m[4];
    const target = resolveSpec(spec, f);
    if (!target || !kernelSet.has(target) || target === f.replaceAll("\\", "/")) continue;
    referencedBy.get(target).add(f.replaceAll("\\", "/"));
    if (isKernel) kernelInternalRefs.get(target).add(f.replaceAll("\\", "/"));
  }
}

let labels = {};
if (existsSync(LABELS_FILE)) {
  labels = JSON.parse(readFileSync(LABELS_FILE, "utf8"));
} else {
  console.error(`❌ 缺标签文件 ${LABELS_FILE}(可为空对象 {},但文件必须在库)`);
  process.exit(1);
}

for (const key of Object.keys(labels)) {
  const norm = join(KERNEL, key).replaceAll("\\", "/");
  if (!kernelSet.has(norm)) {
    console.error(`❌ 标签文件指向不存在的 kernel 文件: ${key}`);
    process.exit(1);
  }
  const tag = labels[key].tag;
  if (!TAGS.has(tag) && tag !== "pending") {
    console.error(`❌ 标签非法(tag 必须是 host/contract/move/pending): ${key} → ${tag}`);
    process.exit(1);
  }
}

const moveViolations = Object.keys(labels).filter((key) => {
  if (labels[key].tag !== "move") return false;
  const norm = join(KERNEL, key).replaceAll("\\", "/");
  return kernelInternalRefs.get(norm).size > 0;
});

if (process.argv.includes("--json")) {
  const payload = kernelFiles.map((f) => {
    const key = relative(KERNEL, f).replaceAll("\\", "/");
    const label = labels[key] ?? {};
    return {
      file: key,
      lines: lines.get(f),
      tag: label.tag ?? "pending",
      note: label.note ?? "",
      referencedByExternal: [...referencedBy.get(f)].filter((p) => !p.startsWith(KERNEL + "/")).sort(),
      kernelInternalRefs: [...kernelInternalRefs.get(f)].sort(),
    };
  });
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

const total = [...lines.values()].reduce((a, b) => a + b, 0);
const byTag = { host: 0, contract: 0, move: 0, pending: 0 };
for (const f of kernelFiles) {
  const key = relative(KERNEL, f).replaceAll("\\", "/");
  byTag[labels[key]?.tag ?? "pending"]++;
}
console.log(`kernel 盘点:${kernelFiles.length} 文件 / ${total} 行`);
console.log(`  host=${byTag.host}  contract=${byTag.contract}  move=${byTag.move}  pending(待审)=${byTag.pending}`);
const pendingTop = kernelFiles
  .filter((f) => (labels[relative(KERNEL, f).replaceAll("\\", "/")]?.tag ?? "pending") === "pending")
  .sort((a, b) => lines.get(b) - lines.get(a))
  .slice(0, 10);
if (pendingTop.length) {
  console.log("待审 Top(按行数,数字以盘点为准,判定人工):");
  for (const f of pendingTop) {
    console.log(`  ${lines.get(f)} 行  ${relative(KERNEL, f)}  ← ${referencedBy.get(f).size} 处引用`);
  }
}

if (process.argv.includes("--check")) {
  if (moveViolations.length > 0) {
    console.error("\n❌ 迁出红线:以下 tag=move 的文件仍被 kernel 内其他文件引用:");
    for (const key of moveViolations) {
      console.error(`  ${key}  ← ${kernelInternalRefs.get(join(KERNEL, key).replaceAll("\\", "/")).join(", ")}`);
    }
    process.exit(1);
  }
  console.log("✅ kernel 盘点检查通过(标签合法,迁出文件无 kernel 内残留引用)。");
}
