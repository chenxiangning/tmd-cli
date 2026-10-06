/**
 * cli-shared/stateFileCache mtime 闸测试(grok 接线消费面;kimi 同款走
 * 相同函数,共享池语义由本套钉死)。ipc 全 mock,跨用例隔离:vi.resetModules
 * 重建模块级 stateCache 单例。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const reads: string[] = [];
let collectStamps: { name: string; path: string; modifiedAt: number }[] = [];

vi.mock("@kernel/ipc", () => ({
  ipc: {
    fsCollectFiles: (_dir: string, _suffix: string) => Promise.resolve(collectStamps),
    fsReadHeads: (paths: string[]) => {
      for (const p of paths) reads.push(p);
      return Promise.resolve(paths.map((p) => JSON.stringify({ ok: true, path: p })));
    },
    fsReadFile: (path: string) => {
      reads.push(path);
      return Promise.resolve(JSON.stringify({ ok: true, path }));
    },
  },
}));

async function fresh() {
  const mod = await import("./stateFileCache");
  return mod;
}

beforeEach(() => {
  vi.resetModules();
  reads.length = 0;
});

describe("stateFileCache mtime 闸", () => {
  it("同 mtime 二扫零重读(miss → 命中)", async () => {
    const { readStatesBatched } = await fresh();
    const entry = { path: "/d/a/summary.json", modifiedAt: 100 };
    const out1 = await readStatesBatched([entry], (t) => ({ t }));
    expect(out1[0]).toBeTruthy();
    const out2 = await readStatesBatched([entry], (t) => ({ t }));
    expect(out2).toEqual(out1); /* 缓存命中返回同解析产物 */
    expect(reads).toEqual(["/d/a/summary.json"]); /* 首扫一次,二扫零增 */
  });

  it("mtime 变化重读并更新缓存", async () => {
    const { readStatesBatched } = await fresh();
    await readStatesBatched([{ path: "/d/b.json", modifiedAt: 1 }], (t) => ({ t }));
    await readStatesBatched([{ path: "/d/b.json", modifiedAt: 2 }], (t) => ({ t }));
    expect(reads).toEqual(["/d/b.json", "/d/b.json"]); /* mtime 变 = 重读 */
    await readStatesBatched([{ path: "/d/b.json", modifiedAt: 2 }], (t) => ({ t }));
    expect(reads).toEqual(["/d/b.json", "/d/b.json"]); /* 新 mtime 落池后命中 */
  });

  it("解析 null 不落缓存:每轮重读(恢复路径)", async () => {
    const { readStatesBatched } = await fresh();
    const entry = { path: "/d/bad.json", modifiedAt: 5 };
    await readStatesBatched([entry], () => null);
    await readStatesBatched([entry], () => null);
    expect(reads).toEqual(["/d/bad.json", "/d/bad.json"]);
  });

  it("pruneStateCache 清理已消失条目", async () => {
    const { readStatesBatched, pruneStateCache } = await fresh();
    await readStatesBatched([{ path: "/d/gone.json", modifiedAt: 1 }], (t) => ({ t }));
    await readStatesBatched([{ path: "/d/live.json", modifiedAt: 1 }], (t) => ({ t }));
    pruneStateCache(new Set(["/d/live.json"]));
    /* gone 被剪:再扫同 mtime 也走重读;live 命中 */
    await readStatesBatched([{ path: "/d/gone.json", modifiedAt: 1 }], (t) => ({ t }));
    await readStatesBatched([{ path: "/d/live.json", modifiedAt: 1 }], (t) => ({ t }));
    expect(reads).toEqual(["/d/gone.json", "/d/live.json", "/d/gone.json"]);
  });
});
