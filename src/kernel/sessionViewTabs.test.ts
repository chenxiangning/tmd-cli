/** 查看器深链契约单测:locate 载荷走 openTab refresh 重触发;普通打开保持旧语义
 *  (不覆盖已开 tab);寻址型重开对已开富 tab 回填缺省字段(防 refresh 刷穷)。 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@kernel/tabs", () => ({
  openTab: vi.fn(),
  getTabContent: vi.fn(),
  getTabs: vi.fn(() => []),
}));

import { getTabs, openTab } from "@kernel/tabs";
import type { EditorTab } from "@kernel/tabs";
import { openSessionViewAtText, openSessionViewTab, type SessionViewTabPayload } from "./sessionViewTabs";

const mockOpen = vi.mocked(openTab);
const mockGetTabs = vi.mocked(getTabs);

beforeEach(() => {
  mockOpen.mockClear();
  mockGetTabs.mockReturnValue([]);
});

describe("openSessionViewTab / openSessionViewAtText", () => {
  it("普通打开:不携带 refresh 选项(已开 tab 保持首次 payload)", () => {
    openSessionViewTab({ profileId: "omp", cliSessionId: "s1" });
    expect(mockOpen).toHaveBeenCalledTimes(1);
    expect(mockOpen.mock.calls[0][1]).toBeUndefined();
    expect(mockOpen.mock.calls[0][0].id).toBe("session-view:omp:s1");
  });

  it("带 locate:refresh 刷 payload,occurrence 缺省 1", () => {
    const payload: SessionViewTabPayload = {
      profileId: "omp", cliSessionId: "s1", cwd: "/w",
      locate: { text: "原文 needle", occurrence: 2 },
    };
    openSessionViewTab(payload);
    const [tab, opts] = mockOpen.mock.calls[0];
    expect(opts).toEqual({ refresh: true });
    expect(tab.payload).toEqual(payload);
    expect(tab.id).toBe("session-view:omp:s1");
  });

  it("带 locate 缺省 occurrence", () => {
    openSessionViewAtText({ profileId: "omp", cliSessionId: "s1" }, "原文");
    expect(mockOpen.mock.calls[0][0].payload).toEqual({
      profileId: "omp", cliSessionId: "s1", locate: { text: "原文", occurrence: 1 },
    });
  });

  it("寻址型重开已开富 tab:回填 title/path/modifiedAt 不被刷穷", () => {
    const prevPayload: SessionViewTabPayload = {
      profileId: "omp", cliSessionId: "s1",
      title: "富标题", path: "/w/.omp/s1.jsonl", modifiedAt: 1234,
    };
    mockGetTabs.mockReturnValue([
      { id: "session-view:omp:s1", kind: "session-view", title: "富标题", path: "s1", payload: prevPayload } as EditorTab,
    ]);
    openSessionViewAtText({ profileId: "omp", cliSessionId: "s1", cwd: "/w" }, "原文");
    const [tabArg, opts] = mockOpen.mock.calls[0];
    expect(opts).toEqual({ refresh: true });
    expect(tabArg.title).toBe("富标题");
    const merged = tabArg.payload as SessionViewTabPayload;
    expect(merged.title).toBe("富标题");
    expect(merged.path).toBe("/w/.omp/s1.jsonl");
    expect(merged.modifiedAt).toBe(1234);
    expect(merged.cwd).toBe("/w");
    expect(merged.locate).toEqual({ text: "原文", occurrence: 1 });
  });

  it("无既有 tab 时 payload 原样(不产幽灵回填)", () => {
    openSessionViewAtText({ profileId: "omp", cliSessionId: "s1", cwd: "/w" }, "原文");
    expect(mockOpen.mock.calls[0][0].payload).toEqual({
      profileId: "omp", cliSessionId: "s1", cwd: "/w", locate: { text: "原文", occurrence: 1 },
    });
  });
});
