/**
 * listCodexSessions meta/标题缓存行为契约(mtime 命中免读头 / 变更仅重读该文件 /
 * 消失剪除 / 坏 meta 不缓存)。重扫 IO 主项 = 每工作区 200 个 rollout 读头 + 命中
 * 会话标题深读,缓存把它收敛为 1 次 fs_collect_files + 仅新/变文件读;
 * 池按 path 全局共享,多工作区并发扫同一目录的重复读直接消失。
 * 批量化(2026-10-04):meta 窗与标题浅窗走 fs_read_heads 批量,深窗兜底批量化
 * (仅浅窗成功且无标题);负结果(无标题/读失败)带 TTL 入缓存免重试风暴。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { listCodexSessions } from "./sessions";

const mocks = vi.hoisted(() => ({
  configHomeDir: vi.fn(),
  fsCollectFiles: vi.fn(),
  fsReadHead: vi.fn(),
  fsReadHeads: vi.fn(),
}));
vi.mock("@kernel/ipc", () => ({
  ipc: {
    configHomeDir: mocks.configHomeDir,
    fsCollectFiles: mocks.fsCollectFiles,
    fsReadHead: mocks.fsReadHead,
    fsReadHeads: mocks.fsReadHeads,
  },
}));
vi.mock("@kernel/platform", () => ({ getPlatformKind: () => "macos" }));

const UUID = "0d03dfef-6824-4a05-b32e-a738c8a48d03";
const META = (cwd: string, id = UUID) =>
  `${JSON.stringify({ timestamp: "2026-09-01T00:00:00.000Z", type: "session_meta", payload: { id, cwd } })}\n`;
const TITLE_HEAD = `${JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "标题甲" }] } })}\n`;

let seq = 0;
/* 唯一目录隔离模块级缓存(metaCache/headCache 跨测试共池)。 */
const stamp = (mtime: number, name = `rollout-2026-09-18T00-00-00-${UUID}.jsonl`) => ({
  name,
  path: `/home/.codex/sessions/2026/09/18/dir-${++seq}/${name}`,
  modifiedAt: mtime,
});

/** 头内容单源设定:批量(meta 4KB / 标题 32KB 浅窗)与深窗单读共用同一实现。 */
const setHead = (impl: (p: string, bytes: number) => string) => {
  mocks.fsReadHeads.mockImplementation(async (ps: string[], bytes: number) => ps.map((p) => impl(p, bytes)));
  mocks.fsReadHead.mockImplementation(async (p: string, bytes: number) => impl(p, bytes));
};
/** 读头总量(批量按 path 数累计 + 深窗逐次)。 */
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
  mocks.configHomeDir.mockResolvedValue("/home");
});

describe("listCodexSessions 读头缓存", () => {
  it("mtime 未变:二次扫描零读头,会话照常", async () => {
    const f = stamp(1000);
    mocks.fsCollectFiles.mockResolvedValue([f]);
    /* meta 走 4KB 身份窗,标题走 32KB 浅窗(浅窗即命中,无深窗兜底)。 */
    setHead((_p, bytes) => (bytes >= 32 * 1024 ? TITLE_HEAD : META("/ws")));
    const first = await listCodexSessions("/ws");
    expect(first.map((s) => s.id)).toEqual([UUID]);
    expect(readCount()).toBe(2); // meta 4KB + 标题 32KB
    clearReads();
    const second = await listCodexSessions("/ws");
    expect(second.map((s) => s.id)).toEqual([UUID]);
    expect(readCount()).toBe(0);
  });

  it("mtime 变化:仅重读该文件(meta+标题),其余走缓存", async () => {
    const hot = stamp(1000);
    const cold = stamp(1000, `rollout-2026-09-18T00-00-00-11111111-2222-4333-8444-555555555555.jsonl`);
    mocks.fsCollectFiles.mockResolvedValue([hot, cold]);
    setHead((p) => (p === hot.path ? META("/ws") : META("/other", "11111111-2222-4333-8444-555555555555")));
    await listCodexSessions("/ws");
    clearReads();
    mocks.fsCollectFiles.mockResolvedValue([{ ...hot, modifiedAt: 2000 }, cold]);
    setHead((p, bytes) =>
      p === hot.path
        ? bytes >= 32 * 1024
          ? TITLE_HEAD
          : META("/ws")
        : META("/other", "11111111-2222-4333-8444-555555555555"),
    );
    const rows = await listCodexSessions("/ws");
    expect(readCount()).toBe(2);
    expect(readPaths().every((p) => p === hot.path)).toBe(true);
    expect(rows[0].title).toBe("标题甲");
  });

  it("collect 已消失的文件:缓存剪除,同路径同 mtime 再现会重读", async () => {
    const f = stamp(1000);
    mocks.fsCollectFiles.mockResolvedValue([f]);
    setHead((_p, bytes) => (bytes >= 32 * 1024 ? TITLE_HEAD : META("/ws")));
    await listCodexSessions("/ws");
    mocks.fsCollectFiles.mockResolvedValue([]);
    await listCodexSessions("/ws");
    mocks.fsCollectFiles.mockResolvedValue([f]);
    clearReads();
    setHead((_p, bytes) => (bytes >= 32 * 1024 ? TITLE_HEAD : META("/ws")));
    await listCodexSessions("/ws");
    /* 剪除证明:meta 身份窗(4KB)重读恰一次;标题池(headCache)同 mtime 命中
       免读(剪除只清 metaCache)—— 读头总量恰 1。 */
    expect(
      mocks.fsReadHeads.mock.calls
        .filter((c) => c[1] < 32 * 1024)
        .reduce((n, c) => n + c[0].length, 0),
    ).toBe(1);
    expect(readCount()).toBe(1);
  });

  it("cwd 不匹配的 rollout 同样入缓存(跨工作区复用,不重复读)", async () => {
    const f = stamp(1000);
    mocks.fsCollectFiles.mockResolvedValue([f]);
    setHead(() => META("/other"));
    await listCodexSessions("/ws");
    expect(readCount()).toBe(1);
    clearReads();
    await listCodexSessions("/ws");
    expect(readCount()).toBe(0);
  });

  it("批量化:meta 与标题各一次批量调用,不再逐文件并发", async () => {
    const ids = [0, 1, 2].map((i) => `1111111${i}-2222-4333-8444-55555555555${i}`);
    const files = ids.map((id, i) => stamp(1000 + i, `rollout-2026-09-18T00-00-00-${id}.jsonl`));
    mocks.fsCollectFiles.mockResolvedValue(files);
    const metaByPath = new Map(files.map((f, i) => [f.path, META("/ws", ids[i])]));
    setHead((p, bytes) => (bytes >= 32 * 1024 ? TITLE_HEAD : metaByPath.get(p) ?? META("/ws")));
    const rows = await listCodexSessions("/ws");
    /* meta 批(3 路径,4KB)+ 标题批(3 路径,32KB)= 恰两次批量调用,零深窗。 */
    expect(mocks.fsReadHeads).toHaveBeenCalledTimes(2);
    expect(mocks.fsReadHeads.mock.calls.every((c) => c[0].length === 3)).toBe(true);
    expect(mocks.fsReadHead).not.toHaveBeenCalled();
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.title === "标题甲")).toBe(true);
  });
});
