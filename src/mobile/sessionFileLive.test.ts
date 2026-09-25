/**
 * pollTranscript 增量拍回归(spec 2026-09-25-mobile-session-render):
 * 尺寸闸 unchanged 短路、changed 整窗重解析、半行/乱码 0 解析保旧态、IPC 失败 null。
 */
import { describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@kernel/transport", () => ({ invoke: invokeMock }));

import { pollTranscript } from "./sessionFile";

const PATH = "/home/u/.omp/agent/sessions/--Users-x-code-tmd-cli-/s1.jsonl";
const PI_USER = JSON.stringify({
  type: "message",
  message: { role: "user", content: [{ type: "text", text: "你好" }] },
});

describe("pollTranscript 增量拍", () => {
  it("unchanged 短路 → null(不 setState)", async () => {
    invokeMock.mockResolvedValueOnce({ changed: false, size: 120, text: "" });
    expect(await pollTranscript(PATH, 120)).toBeNull();
    expect(invokeMock).toHaveBeenCalledWith("fs_read_tail_changed", {
      path: PATH,
      maxBytes: 262144,
      lastSize: 120,
    });
  });

  it("changed → 整窗重解析 + size 回传", async () => {
    invokeMock.mockResolvedValueOnce({
      changed: true,
      size: 240,
      text: `${PI_USER}\n${PI_USER}\n`,
    });
    const r = await pollTranscript(PATH, 120);
    expect(r).not.toBeNull();
    expect(r!.size).toBe(240);
    expect(r!.turns).toHaveLength(2);
    expect(r!.turns[0]).toEqual({ role: "user", text: "你好" });
  });

  it("变化但解析 0 行(半行/未识别)→ null 保旧态,size 不同步", async () => {
    invokeMock.mockResolvedValueOnce({ changed: true, size: 130, text: '{"type":"thin' });
    expect(await pollTranscript(PATH, 120)).toBeNull();
  });

  it("IPC 失败 → null(UI 回落实况,不抛)", async () => {
    invokeMock.mockRejectedValueOnce(new Error("boom"));
    expect(await pollTranscript(PATH, null)).toBeNull();
  });
});
