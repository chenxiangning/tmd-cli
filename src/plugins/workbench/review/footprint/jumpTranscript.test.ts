/** ⌘K 命中 → 转录跳转单测:引用链解析(day 卡原话 → rollup 日会话)与三态桥转发;断链即 miss 不猜。 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@kernel/ipc", () => ({
  ipc: {
    configDir: vi.fn(async () => "/cfg"),
    fsReadFile: vi.fn(async () => {
      throw new Error("missing");
    }),
    fsWriteFile: vi.fn(async () => undefined),
  },
}));
vi.mock("@kernel/fsDirs", () => ({ ensureParentDir: vi.fn(async () => undefined) }));
vi.mock("@kernel/anchorJump", () => ({
  openThenJumpToText: vi.fn(async () => "jumped" as const),
}));
vi.mock("@kernel/sessionViewTabs", () => ({
  openSessionViewAtText: vi.fn(),
}));
vi.mock("@kernel/workspace", () => ({
  getWorkspaces: () => [{ id: "ws1", name: "ws", root: "/ws", createdAt: 0 }],
}));

import { ipc } from "@kernel/ipc";
import { openThenJumpToText, type DiskJumpTarget } from "@kernel/anchorJump";
import { openSessionViewAtText } from "@kernel/sessionViewTabs";
import { resetMonthCache } from "./rollup";
import { fpHitJumpable, jumpHitTranscript } from "./jumpTranscript";
import type { FpHit } from "./dataSource";

const mockIpc = vi.mocked(ipc, true);
const mockJump = vi.mocked(openThenJumpToText);
const mockView = vi.mocked(openSessionViewAtText);
const disk = new Map<string, string>();

const hit = (o: Partial<FpHit> & Pick<FpHit, "day" | "kind" | "snippet">): FpHit => o as FpHit;
const QUOTE = "把登录做成深色";

beforeEach(() => {
  vi.clearAllMocks();
  resetMonthCache();
  disk.clear();
  mockJump.mockResolvedValue("jumped");
  mockIpc.fsReadFile.mockImplementation(async (path: string) => {
    const body = disk.get(path);
    if (body === undefined) throw new Error(`missing:${path}`);
    return body;
  });
  disk.set("/cfg/footprint/2026-03.json", JSON.stringify({
    version: 1,
    days: {
      "14": {
        sessions: { s1: { engine: "claude", cwd: "/ws", turns: [1], first: "", last: "" } },
        files: {},
        batches: {},
      },
    },
  }));
  disk.set("/cfg/footprint/features/2026-03-14.json", JSON.stringify({
    version: 1,
    cards: [
      { title: "无原话卡", summary: "归纳文本", sessions: ["s1"] },
      { title: "带原话卡", summary: "归纳文本", sessions: ["s1"], quote: { sid: "s1", text: QUOTE, time: "10:00" } },
    ],
  }));
});

describe("fpHitJumpable", () => {
  it("card/quote 带 featureId 可跳;digest 摘录与 path/article 不可跳", () => {
    expect(fpHitJumpable(hit({ day: "2026-03-14", kind: "quote", snippet: "x", featureId: 1 }))).toBe(true);
    expect(fpHitJumpable(hit({ day: "2026-03-14", kind: "card", snippet: "x", featureId: 0 }))).toBe(true);
    expect(fpHitJumpable(hit({ day: "2026-03-14", kind: "quote", snippet: "x" }))).toBe(false);
    expect(fpHitJumpable(hit({ day: "2026-03-14", kind: "path", snippet: "x" }))).toBe(false);
    expect(fpHitJumpable(hit({ day: "2026-03-14", kind: "article", snippet: "x" }))).toBe(false);
  });
});

describe("jumpHitTranscript", () => {
  it("卡内原话 → rollup 日会话 → 桥透传(原话全文作 needle)", async () => {
    const out = await jumpHitTranscript(hit({ day: "2026-03-14", kind: "quote", snippet: QUOTE, featureId: 1 }));
    expect(out).toBe("jumped");
    const [target, text] = mockJump.mock.calls[0] as [DiskJumpTarget, string];
    expect(target).toEqual({ profileId: "claude", cwd: "/ws", workspaceId: "ws1", cliSessionId: "s1" });
    expect(text).toBe(QUOTE);
  });

  it("桥 opened/miss → 查看器兜底并改判 opened(提示不报失败)", async () => {
    mockJump.mockResolvedValue("opened");
    await expect(jumpHitTranscript(hit({ day: "2026-03-14", kind: "card", snippet: "x", featureId: 1 }))).resolves.toBe("opened");
    expect(mockView).toHaveBeenCalledWith({ profileId: "claude", cwd: "/ws", cliSessionId: "s1" }, QUOTE);
    mockJump.mockResolvedValue("miss");
    await expect(jumpHitTranscript(hit({ day: "2026-03-14", kind: "card", snippet: "x", featureId: 1 }))).resolves.toBe("opened");
    expect(mockView).toHaveBeenCalledTimes(2);
  });

  it("jumped 不兜底(幕布已定位)", async () => {
    await jumpHitTranscript(hit({ day: "2026-03-14", kind: "quote", snippet: QUOTE, featureId: 1 }));
    expect(mockView).not.toHaveBeenCalled();
  });

  it("卡无原话 / digest 摘录行无引用 → miss 不碰桥", async () => {
    await expect(jumpHitTranscript(hit({ day: "2026-03-14", kind: "card", snippet: "x", featureId: 0 }))).resolves.toBe("miss");
    await expect(jumpHitTranscript(hit({ day: "2026-03-14", kind: "quote", snippet: "x" }))).resolves.toBe("miss");
    expect(mockJump).not.toHaveBeenCalled();
    expect(mockView).not.toHaveBeenCalled();
  });

  it("featureId 越界 / rollup 无该会话归因 → miss 不碰桥", async () => {
    await expect(jumpHitTranscript(hit({ day: "2026-03-14", kind: "quote", snippet: "x", featureId: 9 }))).resolves.toBe("miss");
    disk.set("/cfg/footprint/2026-03.json", JSON.stringify({
      version: 1,
      days: { "14": { sessions: {}, files: {}, batches: {} } },
    }));
    resetMonthCache();
    await expect(jumpHitTranscript(hit({ day: "2026-03-14", kind: "quote", snippet: "x", featureId: 1 }))).resolves.toBe("miss");
    expect(mockJump).not.toHaveBeenCalled();
    expect(mockView).not.toHaveBeenCalled();
  });
});
