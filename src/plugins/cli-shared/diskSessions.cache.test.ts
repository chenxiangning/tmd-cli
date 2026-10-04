/**
 * scanJsonlSessions read-head cache and batching contract (via sessionHead): mtime hit skips read-head /
 * change re-read / disappearance prune / negative-result cache (no-title and read-failure enter the pool with TTL, re-read chase after window expiry or mtime change) /
 * deep-window fallback result likewise enters the cache; shallow window goes through batched
 * fs_read_heads (chunk serial), deep-window fallback only supplementary-reads "shallow window succeeded but no title" and batched.
 * Rescan IO main item = per-file read-head, cache converges "N read-heads per full-library rescan per session open/close" to 1
 * fs_collect_files + read-heads only for new/changed files.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { scanJsonlSessions } from "./diskSessions";
import { readHeadsBatched } from "./sessionHead";

const mocks = vi.hoisted(() => ({
  fsCollectFiles: vi.fn(),
  fsReadHead: vi.fn(),
  fsReadHeads: vi.fn(),
}));
vi.mock("@kernel/ipc", () => ({
  ipc: {
    fsCollectFiles: mocks.fsCollectFiles,
    fsReadHead: mocks.fsReadHead,
    fsReadHeads: mocks.fsReadHeads,
  },
}));

const UUID = "0d03dfef-6824-4a05-b32e-a738c8a48d03";
const NAME = `2026-09-18T00-00-00-000Z_${UUID}.jsonl`;
const DEEP = 256 * 1024;
let seq = 0;

/** 唯一目录隔离模块级缓存;stamp 造 FileStamp,head 造一条带标题的 user 消息行。 */
const mkDir = () => `/tmp/tmd-cache-test/dir-${++seq}`;
const stamp = (dir: string, mtime: number, name = NAME) => ({ name, path: `${dir}/${name}`, modifiedAt: mtime });
const headLine = (title: string) => `${JSON.stringify({ type: "message", message: { role: "user", content: title } })}\n`;

/** 头内容单源设定:浅窗批读与深窗单读共用同一 (path, bytes) 实现。 */
const setHead = (impl: (p: string, bytes: number) => string) => {
  mocks.fsReadHeads.mockImplementation(async (ps: string[], bytes: number) => ps.map((p) => impl(p, bytes)));
  mocks.fsReadHead.mockImplementation(async (p: string, bytes: number) => impl(p, bytes));
};
/** 读头总量(批量按 path 数累计 + 深窗逐次)/ 已读路径按序。 */
const readCount = () =>
  mocks.fsReadHeads.mock.calls.reduce((n, c) => n + c[0].length, 0) + mocks.fsReadHead.mock.calls.length;
const readPaths = () => [
  ...mocks.fsReadHeads.mock.calls.flatMap((c) => c[0]),
  ...mocks.fsReadHead.mock.calls.map((c) => c[0]),
];
const clearReads = () => {
  mocks.fsReadHeads.mockClear();
  mocks.fsReadHead.mockClear();
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("scanJsonlSessions 读头缓存", () => {
  it("mtime 未变:二次扫描零读头,标题照常", async () => {
    const dir = mkDir();
    mocks.fsCollectFiles.mockResolvedValue([stamp(dir, 1000)]);
    setHead(() => headLine("标题甲"));
    const first = await scanJsonlSessions(dir);
    expect(first.map((s) => s.title)).toEqual(["标题甲"]);
    expect(readCount()).toBe(1);
    clearReads();
    const second = await scanJsonlSessions(dir);
    expect(second.map((s) => s.title)).toEqual(["标题甲"]);
    expect(readCount()).toBe(0);
  });

  it("mtime 变化:仅重读该文件,其余走缓存", async () => {
    const dir = mkDir();
    const other = stamp(dir, 1000, `2026-09-18T00-00-00-000Z_11111111-2222-4333-8444-555555555555.jsonl`);
    mocks.fsCollectFiles.mockResolvedValue([stamp(dir, 1000), other]);
    setHead(() => headLine("标题乙"));
    await scanJsonlSessions(dir);
    expect(readCount()).toBe(2);
    mocks.fsCollectFiles.mockResolvedValue([stamp(dir, 2000), other]);
    clearReads();
    await scanJsonlSessions(dir);
    expect(readCount()).toBe(1);
    expect(readPaths()[0]).toBe(`${dir}/${NAME}`);
  });

  it("文件消失:缓存条目剪除,同路径同 mtime 再现会重读", async () => {
    const dir = mkDir();
    mocks.fsCollectFiles.mockResolvedValue([stamp(dir, 1000)]);
    setHead(() => headLine("标题丙"));
    await scanJsonlSessions(dir);
    mocks.fsCollectFiles.mockResolvedValue([]);
    await scanJsonlSessions(dir);
    mocks.fsCollectFiles.mockResolvedValue([stamp(dir, 1000)]);
    clearReads();
    await scanJsonlSessions(dir);
    expect(readCount()).toBe(1);
  });

  it("读头无标题:负结果缓存,窗内重扫零读头;mtime 变化立即重读追赶", async () => {
    const dir = mkDir();
    mocks.fsCollectFiles.mockResolvedValue([stamp(dir, 1000)]);
    setHead(() => "not json garbage\n");
    await scanJsonlSessions(dir);
    clearReads();
    await scanJsonlSessions(dir);
    /* 负结果(无标题)带 TTL 入池:窗内重扫免读(外网拥塞收敛根治) */
    expect(readCount()).toBe(0);
    /* 自动命名落盘 = mtime 变化:负结果立即失效重读追赶 */
    mocks.fsCollectFiles.mockResolvedValue([stamp(dir, 2000)]);
    clearReads();
    await scanJsonlSessions(dir);
    expect(readCount()).toBeGreaterThan(0);
  });

  it("负结果缓存 TTL 过窗:追读一次", async () => {
    vi.useFakeTimers();
    try {
      const dir = mkDir();
      mocks.fsCollectFiles.mockResolvedValue([stamp(dir, 1000)]);
      setHead(() => "not json garbage\n");
      await scanJsonlSessions(dir);
      clearReads();
      vi.advanceTimersByTime(5 * 60_000 + 1);
      await scanJsonlSessions(dir);
      expect(readCount()).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("浅窗截断坏行走深窗兜底:解析结果同样入缓存", async () => {
    const dir = mkDir();
    mocks.fsCollectFiles.mockResolvedValue([stamp(dir, 1000)]);
    /* 真实形态:首条用户消息巨大,浅窗截成坏行(非空但解析不出),深窗全行有标题 */
    setHead((_p, bytes) => (bytes >= DEEP ? headLine("深窗标题") : "{\"type\":\"message\",\"message\":{\"role\":\"user\",\"con"));
    const first = await scanJsonlSessions(dir);
    expect(first.map((s) => s.title)).toEqual(["深窗标题"]);
    expect(readCount()).toBe(2); // 浅窗 miss + 深窗命中
    clearReads();
    const second = await scanJsonlSessions(dir);
    expect(second.map((s) => s.title)).toEqual(["深窗标题"]);
    expect(readCount()).toBe(0);
  });

  it("浅窗读失败(空串):不深窗补读,负结果缓存免重试风暴", async () => {
    const dir = mkDir();
    mocks.fsCollectFiles.mockResolvedValue([stamp(dir, 1000)]);
    setHead(() => "");
    await scanJsonlSessions(dir);
    /* Read failure larger window likewise unreadable: only shallow window batch once, no per-file deep-window retry */
    expect(mocks.fsReadHeads).toHaveBeenCalledTimes(1);
    expect(mocks.fsReadHead).not.toHaveBeenCalled();
  });

  it("批量化:多文件浅窗合并一次 fs_read_heads(单 chunk),下标对齐", async () => {
    const dir = mkDir();
    const names = [0, 1, 2].map(
      (i) => `2026-09-18T00-00-00-000Z_1111111${i}-2222-4333-8444-55555555555${i}.jsonl`,
    );
    mocks.fsCollectFiles.mockResolvedValue(names.map((n, i) => stamp(dir, 1000 + i, n)));
    setHead((p) => headLine(`标题-${p.slice(-6)}`));
    const rows = await scanJsonlSessions(dir);
    /* 单 chunk:3 路径一次批量;无深窗(标题全中)。 */
    expect(mocks.fsReadHeads).toHaveBeenCalledTimes(1);
    expect(mocks.fsReadHeads.mock.calls[0][0]).toHaveLength(3);
    expect(mocks.fsReadHead).not.toHaveBeenCalled();
    expect(rows.every((r) => r.title?.startsWith("标题-"))).toBe(true);
  });
});

describe("readHeadsBatched 分片", () => {
  it("响应预算分 chunk 串行:32KB 窗 25 路径 = 24+1 两次调用,顺序对齐", async () => {
    mocks.fsReadHeads.mockImplementation(async (ps: string[]) => ps.map((p) => `h:${p}`));
    const paths = Array.from({ length: 25 }, (_, i) => `/p/${i}.jsonl`);
    const heads = await readHeadsBatched(paths, 32 * 1024);
    expect(mocks.fsReadHeads).toHaveBeenCalledTimes(2);
    expect(mocks.fsReadHeads.mock.calls[0][0]).toHaveLength(24);
    expect(mocks.fsReadHeads.mock.calls[1][0]).toHaveLength(1);
    expect(heads).toEqual(paths.map((p) => `h:${p}`));
  });

  it("批量调用整体失败:该 chunk 全空串(与逐文件失败同语义)", async () => {
    mocks.fsReadHeads.mockRejectedValue(new Error("bridge disconnected"));
    const heads = await readHeadsBatched(["/a", "/b"], 32 * 1024);
    expect(heads).toEqual(["", ""]);
  });
});
