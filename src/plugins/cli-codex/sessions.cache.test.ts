/**
 * listCodexSessions meta/标题缓存行为契约(mtime 命中免读头 / 变更仅重读该文件 /
 * 消失剪除 / 坏 meta 不缓存)。重扫 IO 主项 = 每工作区 200 个 rollout 读头 + 命中
 * 会话标题深读,缓存把它收敛为 1 次 fs_collect_files + 仅新/变文件读;
 * 池按 path 全局共享,多工作区并发扫同一目录的重复读直接消失。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { listCodexSessions } from "./sessions";

const mocks = vi.hoisted(() => ({
  configHomeDir: vi.fn(),
  fsCollectFiles: vi.fn(),
  fsReadHead: vi.fn(),
}));
vi.mock("@kernel/ipc", () => ({ ipc: { configHomeDir: mocks.configHomeDir, fsCollectFiles: mocks.fsCollectFiles, fsReadHead: mocks.fsReadHead } }));
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.configHomeDir.mockResolvedValue("/home");
});

describe("listCodexSessions 读头缓存", () => {
  it("mtime 未变:二次扫描零读头,会话照常", async () => {
    const f = stamp(1000);
    mocks.fsCollectFiles.mockResolvedValue([f]);
    /* meta 走 4KB 身份窗,标题走 32KB 浅窗(浅窗即命中,无深窗兜底)。 */
    mocks.fsReadHead.mockImplementation(async (_p: string, bytes: number) => (bytes >= 32 * 1024 ? TITLE_HEAD : META("/ws")));
    const first = await listCodexSessions("/ws");
    expect(first.map((s) => s.id)).toEqual([UUID]);
    const reads = mocks.fsReadHead.mock.calls.length; // meta 4KB + 标题 32KB
    expect(reads).toBe(2);
    mocks.fsReadHead.mockClear();
    const second = await listCodexSessions("/ws");
    expect(second.map((s) => s.id)).toEqual([UUID]);
    expect(mocks.fsReadHead).not.toHaveBeenCalled();
  });

  it("mtime 变化:仅重读该文件(meta+标题),其余走缓存", async () => {
    const hot = stamp(1000);
    const cold = stamp(1000, `rollout-2026-09-18T00-00-00-11111111-2222-4333-8444-555555555555.jsonl`);
    mocks.fsCollectFiles.mockResolvedValue([hot, cold]);
    mocks.fsReadHead.mockImplementation(async (p: string) => (p === hot.path ? META("/ws") : META("/other", "11111111-2222-4333-8444-555555555555")));
    await listCodexSessions("/ws");
    mocks.fsReadHead.mockClear();
    mocks.fsCollectFiles.mockResolvedValue([{ ...hot, modifiedAt: 2000 }, cold]);
    mocks.fsReadHead.mockImplementation(async (p: string, bytes: number) =>
      p === hot.path ? (bytes >= 32 * 1024 ? TITLE_HEAD : META("/ws")) : META("/other", "11111111-2222-4333-8444-555555555555"),
    );
    const rows = await listCodexSessions("/ws");
    expect(mocks.fsReadHead).toHaveBeenCalledTimes(2);
    expect(mocks.fsReadHead.mock.calls.every((c) => c[0] === hot.path)).toBe(true);
    expect(rows[0].title).toBe("标题甲");
  });

  it("collect 已消失的文件:缓存剪除,同路径同 mtime 再现会重读", async () => {
    const f = stamp(1000);
    mocks.fsCollectFiles.mockResolvedValue([f]);
    mocks.fsReadHead.mockImplementation(async (_p: string, bytes: number) => (bytes >= 32 * 1024 ? TITLE_HEAD : META("/ws")));
    await listCodexSessions("/ws");
    mocks.fsCollectFiles.mockResolvedValue([]);
    await listCodexSessions("/ws");
    mocks.fsCollectFiles.mockResolvedValue([f]);
    mocks.fsReadHead.mockClear();
    mocks.fsReadHead.mockImplementation(async (_p: string, bytes: number) => (bytes >= 32 * 1024 ? TITLE_HEAD : META("/ws")));
    await listCodexSessions("/ws");
    /* 剪除证明:meta 身份窗(4KB)重读恰一次;标题窗另一次(浅窗即命中)。 */
    expect(mocks.fsReadHead.mock.calls.filter((c) => c[1] < 32 * 1024)).toHaveLength(1);
  });

  it("cwd 不匹配的 rollout 同样入缓存(跨工作区复用,不重复读)", async () => {
    const f = stamp(1000);
    mocks.fsCollectFiles.mockResolvedValue([f]);
    mocks.fsReadHead.mockResolvedValue(META("/other"));
    await listCodexSessions("/ws");
    expect(mocks.fsReadHead).toHaveBeenCalledTimes(1);
    mocks.fsReadHead.mockClear();
    await listCodexSessions("/ws");
    expect(mocks.fsReadHead).not.toHaveBeenCalled();
  });
});
