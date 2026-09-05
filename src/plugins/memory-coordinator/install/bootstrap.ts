/**
 * 共享库 bootstrap —— tmd-cli 打包的迁移触发脚本(经 proc_communicate 跑 node)。
 *
 * 机制(PoC 实证):Magic Context 插件 dist 的 chunk 是可 import 的 ESM,
 * `openDatabase` 打开共享库时自动完成「锁检测 + 版本围栏 + 增量迁移」。
 * 此刻若机器上仍有其他 omp/pi 进程 → openDatabase 返回 null(迁移被拒),
 * 编排据此进入「迁移窗口」状态机,而非崩溃。
 *
 * 用法:node mc-bootstrap.mjs <插件 dist 目录>
 * 输出:BOOTSTRAP-OK <dbPath> <schemaVersion> / REFUSED <阻塞进程摘要>
 */

export const BOOTSTRAP_MJS = String.raw`
const path = await import("node:path");
const fs = await import("node:fs");

// node -e 模式下首参在 argv[1];脚本文件模式在 argv[2] —— 两者兼容
const distDir = process.argv[2] || process.argv[1];
if (!distDir) {
  console.log("REFUSED no-dist-dir");
  process.exit(0);
}

// 定位 core chunk(导出 openDatabase)与 util chunk(导出 getMagicContextStorageDir):
// dist chunk 文件名随版本变化,一律动态扫描导出面,不硬编码哈希文件名
const chunks = fs
  .readdirSync(distDir)
  .filter((f) => /^index-[\w-]+\.js$/.test(f))
  .map((f) => path.join(distDir, f));
let core = null;
let util = null;
for (const file of chunks) {
  const mod = await import(pathToFileUrl(file));
  if (!core && typeof mod.openDatabase === "function") core = mod;
  if (!util && typeof mod.getMagicContextStorageDir === "function") util = mod;
  if (core && util) break;
}
if (!core) {
  console.log("REFUSED openDatabase-chunk-not-found");
  process.exit(0);
}
if (!util) {
  console.log("REFUSED util-chunk-not-found");
  process.exit(0);
}

function pathToFileUrl(p) {
  const abs = path.resolve(p).replace(/\\/g, "/");
  return "file://" + (abs.startsWith("/") ? abs : "/" + abs);
}

const storageDir = util.getMagicContextStorageDir() ?? null;

const db = core.openDatabase(storageDir ? { dbPath: path.join(storageDir, "context.db") } : {});
if (!db) {
  console.log("REFUSED migration-locked");
  process.exit(0);
}
const v = db.prepare("SELECT max(version) v FROM schema_migrations").get();
const n = db.prepare("SELECT count(*) n FROM memories").get();
console.log("BOOTSTRAP-OK " + (storageDir ?? "?") + " schema=" + (v?.v ?? 0) + " memories=" + (n?.n ?? 0));
`;
