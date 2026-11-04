/**
 * 回顾二级视图契约(reviewTabs):
 * - 视图偏好独立 key,读写回落(坏档/隐私态 → journal);
 * - 深链 payload 宽容校验:合法 view/day 透传,非法逐项回落;
 * - 主 tab 数 = 5(journal id 保留,显示名「回顾」);
 * - openWorkbenchReviewTab:payload {tab:"journal", review} + refresh 重开。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const openTabMock = vi.hoisted(() => ({ openTab: vi.fn() }));
vi.mock("@kernel/tabs", () => openTabMock);
const tMock = vi.hoisted(() => ({ t: (k: string) => k }));
vi.mock("@kernel/i18n", () => tMock);

import { WB_TAB_ITEMS } from "../wbTabs";
import {
  REVIEW_VIEW_ITEMS,
  loadReviewView,
  normalizeReviewPayload,
  openWorkbenchReviewTab,
  saveReviewView,
} from "./reviewTabs";

const VIEW_KEY = "tmd.wb.review.view.v1";

describe("回顾视图偏好(独立 key)", () => {
  beforeEach(() => {
    const mem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
      setItem: (k: string, v: string) => void mem.set(k, String(v)),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
    });
  });

  it("缺省/坏档回落 journal", () => {
    expect(loadReviewView()).toBe("journal");
    localStorage.setItem(VIEW_KEY, "garbage");
    expect(loadReviewView()).toBe("journal");
  });

  it("合法视图读写往返;不回写 journal 自持 key", () => {
    saveReviewView("footprint");
    expect(loadReviewView()).toBe("footprint");
    expect(localStorage.getItem("tmd.wb.journal.view" as never)).toBeNull();
    expect(localStorage.getItem("wb.journal.view" as never)).toBeNull();
  });
});

describe("深链 payload 归一", () => {
  it("合法 view/day 透传", () => {
    expect(normalizeReviewPayload({ view: "footprint", day: "2026-11-04" })).toEqual({
      view: "footprint",
      day: "2026-11-04",
    });
  });

  it("非法逐项回落:view 白名单外丢弃、day 非 YYYY-MM-DD 丢弃、非对象清空", () => {
    expect(normalizeReviewPayload({ view: "nope", day: "2026-11-04" })).toEqual({ day: "2026-11-04" });
    expect(normalizeReviewPayload({ view: "journal", day: "11/4" })).toEqual({ view: "journal" });
    expect(normalizeReviewPayload("junk")).toEqual({});
    expect(normalizeReviewPayload(null)).toEqual({});
  });
});

describe("主 tab 与深链入口", () => {
  it("主 tab 仍 5 个;journal id 保留,显示名改「回顾」", () => {
    expect(WB_TAB_ITEMS).toHaveLength(5);
    const journal = WB_TAB_ITEMS.find((i) => i.key === "journal");
    expect(journal?.label).toBe("回顾");
  });

  it("二级视图清单 = journal/footprint/sessions", () => {
    expect(REVIEW_VIEW_ITEMS.map((v) => v.key)).toEqual(["journal", "footprint", "sessions"]);
  });

  it("openWorkbenchReviewTab:wb console payload 带 tab:journal + review,且 refresh 重开", () => {
    openWorkbenchReviewTab({ view: "sessions", day: "2026-11-04" });
    expect(openTabMock.openTab).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { tab: "journal", review: { view: "sessions", day: "2026-11-04" } },
      }),
      { refresh: true },
    );
    openWorkbenchReviewTab({ view: "bad" as unknown as import("./reviewTabs").ReviewView });
    expect(openTabMock.openTab).toHaveBeenLastCalledWith(
      expect.objectContaining({ payload: { tab: "journal", review: {} } }),
      { refresh: true },
    );
  });
});
