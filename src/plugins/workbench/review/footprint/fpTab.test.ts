/**
 * fpTab 深链契约(payload.day)—— C-02 起打开 = 「回顾 → 每日足迹」二级视图
 * (payload {tab:"journal", review:{view:"footprint", day}};旧 footprint.daily
 * 中央 tab 由工作台兼容渲染,openFootprintTab 不再开旧 kind):
 * 缺省 review 无 day(视图开今日)/ 带 day 直达 / 已开 refresh 刷 payload 不新增 tab
 * (kernel/tabs openTab refresh opt-in 深链重开场景)。
 * tab store 模块级单例,每个用例经 vi.resetModules + 动态 import 取全新实例
 * (journalTabs.test 同款 harness;静态 import 拿不到 reset 后的新实例,
 * 此处动态加载是刻意的模块边界测试)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as TabsNs from "@kernel/tabs";
import type * as FpTabNs from "./fpTab";
import type * as WbTabsNs from "../../wbTabs";

let tabs: typeof TabsNs;
let fp: typeof FpTabNs;
let wbTabs: typeof WbTabsNs;

beforeEach(async () => {
  vi.resetModules();
  tabs = await import("@kernel/tabs");
  fp = await import("./fpTab");
  wbTabs = await import("../../wbTabs");
});

describe("openFootprintTab 深链(C-02 回顾宿主)", () => {
  it("缺省:开回顾页签,review = {view:footprint},无 day(视图按今日初始化)", () => {
    fp.openFootprintTab();
    const tab = tabs.getTabs().find((x) => x.id === wbTabs.WB_CONSOLE_TAB_ID);
    expect(tab?.kind).toBe(wbTabs.WB_CONSOLE_TAB_KIND);
    expect(tab?.payload).toEqual({ tab: "journal", review: { view: "footprint" } });
  });

  it("带 day:review 携带 {day}", () => {
    fp.openFootprintTab({ day: "2026-10-19" });
    const tab = tabs.getTabs().find((x) => x.id === wbTabs.WB_CONSOLE_TAB_ID);
    expect(tab?.payload).toEqual({ tab: "journal", review: { view: "footprint", day: "2026-10-19" } });
  });

  it("已开再深链:refresh 刷 payload 且不新增 tab", () => {
    fp.openFootprintTab();
    fp.openFootprintTab({ day: "2026-09-01" });
    const all = tabs.getTabs().filter((x) => x.id === wbTabs.WB_CONSOLE_TAB_ID);
    expect(all).toHaveLength(1);
    expect(all[0].payload).toEqual({ tab: "journal", review: { view: "footprint", day: "2026-09-01" } });
  });
});

describe("fpYmOfDay", () => {
  it("合法日 → {y,m};缺省/非法/月日出界 → null", () => {
    expect(fp.fpYmOfDay("2026-10-19")).toEqual({ y: 2026, m: 10 });
    expect(fp.fpYmOfDay(undefined)).toBeNull();
    expect(fp.fpYmOfDay("bad")).toBeNull();
    expect(fp.fpYmOfDay("2026-13-01")).toBeNull();
  });
});
