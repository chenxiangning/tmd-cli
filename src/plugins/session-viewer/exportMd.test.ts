/**
 * exportMd 落盘内核契约(mock ipc/host,仿 log.test.ts 先例):
 * - no-adapter 不抛(引擎未声明/未注册适配器);
 * - unreadable 归一(listSessions 找不到 / 读取返回 null / 读取抛错);
 * - write-failed 归一(fsWriteFile 拒绝);
 * - 重名防撞:同批 taken 命中 → -2;-2 也占 → -3 递增;盘上已存在同样让位;
 * - 快照:落指定完整路径,返回导出时点。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const fsReadHead = vi.hoisted(() => vi.fn());
const fsWriteFile = vi.hoisted(() => vi.fn(async () => undefined));
const fsCreateDir = vi.hoisted(() => vi.fn(async () => undefined));
const getCliProfile = vi.hoisted(() => vi.fn());
vi.mock("@kernel/ipc", () => ({
  ipc: { fsReadHead, fsWriteFile, fsCreateDir },
}));
vi.mock("@kernel/host", () => ({
  host: { getCliProfile },
}));

import { dedupeExportName, exportMdTo, snapshotMdTo } from "./exportMd";

const PROFILE = {
  id: "claude",
  readSessionTranscript: vi.fn(
    async (_s: unknown): Promise<{ blocks: never[]; truncated: boolean } | null> => ({
      blocks: [],
      truncated: false,
    }),
  ),
};

const TARGET = { cliSessionId: "sess-1", title: "会话标题", profileId: "claude", path: "/tmp/sess-1.jsonl" };

beforeEach(() => {
  fsReadHead.mockReset();
  fsWriteFile.mockClear();
  fsCreateDir.mockClear();
  getCliProfile.mockReset();
  PROFILE.readSessionTranscript.mockClear();
  getCliProfile.mockReturnValue(PROFILE);
});

describe("exportMdTo", () => {
  it("正常落盘:写 dir/标题-slug-日期.md,返回文件名", async () => {
    fsReadHead.mockRejectedValue(new Error("missing"));
    const r = await exportMdTo("/out", TARGET, new Set());
    if (!r.ok) throw new Error("expected ok");
    expect(r.fileName).toMatch(/^会话标题-\d{8}\.md$/);
    expect(fsWriteFile).toHaveBeenCalledWith(`/out/${r.fileName}`, expect.stringContaining("# 会话标题"));
  });

  it("适配器缺失 → no-adapter,不抛也不写盘", async () => {
    getCliProfile.mockReturnValue({ id: "shell" });
    const r = await exportMdTo("/out", { ...TARGET, profileId: "shell" });
    expect(r).toEqual({ ok: false, reason: "no-adapter" });
    expect(fsWriteFile).not.toHaveBeenCalled();
  });

  it("引擎未注册 → no-adapter", async () => {
    getCliProfile.mockReturnValue(undefined);
    const r = await exportMdTo("/out", TARGET);
    expect(r).toEqual({ ok: false, reason: "no-adapter" });
  });

  it("活会话无 path:listSessions 找不到同 id → unreadable", async () => {
    const profile = {
      id: "claude",
      listSessions: vi.fn(async () => [{ id: "other", modifiedAt: 1, path: "/x.jsonl" }]),
      readSessionTranscript: PROFILE.readSessionTranscript,
    };
    getCliProfile.mockReturnValue(profile);
    const r = await exportMdTo("/out", { cliSessionId: "sess-1", profileId: "claude", cwd: "/ws" });
    expect(r).toEqual({ ok: false, reason: "unreadable" });
  });

  it("读取返回 null / 抛错 → unreadable", async () => {
    fsReadHead.mockRejectedValue(new Error("missing"));
    PROFILE.readSessionTranscript.mockResolvedValueOnce(null);
    expect(await exportMdTo("/out", TARGET)).toEqual({ ok: false, reason: "unreadable" });
    PROFILE.readSessionTranscript.mockRejectedValueOnce(new Error("boom"));
    expect(await exportMdTo("/out", TARGET)).toEqual({ ok: false, reason: "unreadable" });
  });

  it("写盘失败 → write-failed", async () => {
    fsReadHead.mockRejectedValue(new Error("missing"));
    fsWriteFile.mockRejectedValueOnce(new Error("ENOSPC"));
    const r = await exportMdTo("/out", TARGET);
    expect(r).toEqual({ ok: false, reason: "write-failed" });
  });

  it("重名防撞:同批 taken 命中 → -2;-2 也占 → -3 递增,并回填 taken", async () => {
    fsReadHead.mockRejectedValue(new Error("missing"));
    const taken = new Set<string>();
    const first = await exportMdTo("/out", TARGET, taken);
    if (!first.ok) throw new Error("expected ok");
    /* 第二次同目标:基名在 taken → 让位 -2;第三次 -2 也在 taken → -3 */
    const second = await exportMdTo("/out", TARGET, taken);
    if (!second.ok) throw new Error("expected ok");
    expect(second.fileName).toBe(first.fileName.replace(/\.md$/, "-2.md"));
    const third = await exportMdTo("/out", TARGET, taken);
    if (!third.ok) throw new Error("expected ok");
    expect(third.fileName).toBe(first.fileName.replace(/\.md$/, "-3.md"));
  });
});

describe("dedupeExportName", () => {
  it("盘上已存在的基名让位 -2;空位即用", async () => {
    fsReadHead.mockImplementation((path: string) =>
      path.includes("-2.md") ? Promise.reject(new Error("missing")) : Promise.resolve("x"),
    );
    const name = await dedupeExportName("/out", TARGET);
    expect(name).toMatch(/^会话标题-\d{8}-2\.md$/);
  });
});

describe("snapshotMdTo", () => {
  it("落指定完整路径并返回导出时点与块统计(viewer 单文件另存同路径);适配器缺失 → no-adapter", async () => {
    fsReadHead.mockRejectedValue(new Error("missing"));
    const r = await snapshotMdTo("/out/自选.md", TARGET);
    if (!r.ok) throw new Error("expected ok");
    expect(fsWriteFile).toHaveBeenCalledWith("/out/自选.md", expect.stringContaining("# 会话标题"));
    expect(r.out).toMatchObject({ blocks: 0, skippedThinking: 0, skippedImages: 0 });
    getCliProfile.mockReturnValue(undefined);
    expect(await snapshotMdTo("/out/自选.md", TARGET)).toEqual({ ok: false, reason: "no-adapter" });
  });

  it("viewer 活会话同路径:无 path 有 cwd,经 listSessions 兜底定位后落盘", async () => {
    const profile = {
      id: "claude",
      listSessions: vi.fn(async () => [
        { id: "other", modifiedAt: 1, path: "/x.jsonl" },
        { id: "sess-1", modifiedAt: 2, path: "/ws/.claude/sess-1.jsonl" },
      ]),
      readSessionTranscript: vi.fn(async (disk: { path: string }) => {
        expect(disk.path).toBe("/ws/.claude/sess-1.jsonl");
        return { blocks: [], truncated: false };
      }),
    };
    getCliProfile.mockReturnValue(profile);
    const r = await snapshotMdTo("/out/快照.md", { cliSessionId: "sess-1", title: "标题", profileId: "claude", cwd: "/ws" });
    expect(r.ok).toBe(true);
    expect(fsWriteFile).toHaveBeenCalledWith("/out/快照.md", expect.any(String));
  });
});
