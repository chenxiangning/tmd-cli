/** 查看器深链契约单测:locate 载荷走 openTab refresh 重触发;普通打开保持旧语义(不覆盖已开 tab)。 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@kernel/tabs", () => ({
  openTab: vi.fn(),
  getTabContent: vi.fn(),
}));

import { openTab } from "@kernel/tabs";
import { openSessionViewAtText, openSessionViewTab, type SessionViewTabPayload } from "./sessionViewTabs";

const mockOpen = vi.mocked(openTab);

beforeEach(() => mockOpen.mockClear());

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
});
