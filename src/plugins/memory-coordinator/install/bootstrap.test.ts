/**
 * 共享库 bootstrap 脚本(install/bootstrap.ts 的 BOOTSTRAP_MJS)契约测试。
 *
 * 用 node -e 真跑脚本(与编排 runBootstrap 同路径),chunk 文件名刻意随机:
 * core chunk(导出 openDatabase)与 util chunk(导出 getMagicContextStorageDir)
 * 都必须动态扫描导出面定位 —— 硬编码哈希文件名的旧实现在本用例下会静默降级
 * (storageDir=null)或 REFUSED 错对象。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BOOTSTRAP_MJS } from "./bootstrap";

const CORE_CHUNK = `
export function openDatabase() {
  return {
    prepare: (sql) => ({
      get: () => (sql.includes("max(version)") ? { v: 3 } : { n: 7 }),
    }),
  };
}
`;
const UTIL_CHUNK = `export function getMagicContextStorageDir() { return "/tmp/mc-store"; }\n`;

const tmpDirs: string[] = [];

function mkDist(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-bootstrap-"));
  tmpDirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

function run(distDir: string): string {
  return execFileSync(process.execPath, ["-e", BOOTSTRAP_MJS, distDir], {
    encoding: "utf8",
    timeout: 20_000,
  }).trim();
}

afterEach(() => {
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

describe("BOOTSTRAP_MJS chunk 动态扫描", () => {
  it("core + util chunk 齐备:BOOTSTRAP-OK 带出 storageDir/schema/ memories 计数", () => {
    /* 哈希名随机化:旧硬编码 index-147qn1yq.js 在本用例下必败 */
    const dir = mkDist({
      "index-a1b2c3.js": CORE_CHUNK,
      "index-z9y8x7.js": UTIL_CHUNK,
    });
    expect(run(dir)).toBe("BOOTSTRAP-OK /tmp/mc-store schema=3 memories=7");
  });

  it("util chunk 缺失:REFUSED util-chunk-not-found(不静默降级 storageDir=null)", () => {
    const dir = mkDist({ "index-a1b2c3.js": CORE_CHUNK });
    expect(run(dir)).toBe("REFUSED util-chunk-not-found");
  });

  it("core chunk 缺失:REFUSED openDatabase-chunk-not-found", () => {
    const dir = mkDist({ "index-z9y8x7.js": UTIL_CHUNK });
    expect(run(dir)).toBe("REFUSED openDatabase-chunk-not-found");
  });

  it("dist 目录无任何 chunk:REFUSED openDatabase-chunk-not-found", () => {
    const dir = mkDist({ "README.txt": "not a chunk" });
    expect(run(dir)).toBe("REFUSED openDatabase-chunk-not-found");
  });
});
