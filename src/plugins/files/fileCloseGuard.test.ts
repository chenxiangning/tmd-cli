/**
 * fileBeforeClose 契约(kind="file" 的 beforeClose 闸):
 * - 不脏:直接放行,不问确认;
 * - 脏 + 确认丢弃:draftDelete(草稿必须真删,否则重开原地复活)= 弹窗承诺);
 * - 脏 + 取消:保留 tab,草稿原样;
 * - 确认链路异常按不放行(kernel tabClose 协调器同口径兜底,本闸自身不吞)。
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { EditorTab } from "@kernel/tabs";

const askMock = vi.fn<(o: { title: string }) => Promise<boolean>>();
vi.mock("@kernel/askDialog", () => ({ askDialog: (o: { title: string }) => askMock(o) }));
vi.mock("@kernel/i18n", () => ({ t: (k: string) => k }));
const draftDeleteMock = vi.fn();
vi.mock("./editor/fileCache", () => ({
  draftDelete: (...a: unknown[]) => draftDeleteMock(...a),
}));

import { fileBeforeClose } from "./fileCloseGuard";

function tab(dirty: boolean): EditorTab {
  return {
    id: "file:/tmp/a.md",
    title: "a.md",
    path: "/tmp/a.md",
    kind: "file",
    payload: { path: "/tmp/a.md" },
    dirty,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fileBeforeClose", () => {
  it("不脏:放行且不弹确认", async () => {
    await expect(fileBeforeClose(tab(false))).resolves.toBe(true);
    expect(askMock).not.toHaveBeenCalled();
  });

  it("脏 + 丢弃:删草稿后放行", async () => {
    askMock.mockResolvedValue(true);
    await expect(fileBeforeClose(tab(true))).resolves.toBe(true);
    expect(askMock).toHaveBeenCalledOnce();
    expect(draftDeleteMock).toHaveBeenCalledWith("/tmp/a.md");
  });

  it("脏 + 取消:保留 tab 且草稿原样", async () => {
    askMock.mockResolvedValue(false);
    await expect(fileBeforeClose(tab(true))).resolves.toBe(false);
    expect(draftDeleteMock).not.toHaveBeenCalled();
  });
});
