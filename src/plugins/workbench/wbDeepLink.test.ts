/** wbDeepLink 深链归一契约(批次 C 抽出):docs 带过滤同移、journal 只落页签
 *  (文档过滤保持原状)、无深链/未知 tab 零动作。 */
import { describe, expect, it } from "vitest";
import { deepLinkTarget } from "./wbDeepLink";

describe("deepLinkTarget 工作台深链", () => {
  it("docs 深链:页签与项目过滤同移", () => {
    expect(deepLinkTarget({ tab: "docs", projectFilter: "p1" }))
      .toEqual({ tab: "docs", docsFilter: "p1" });
    expect(deepLinkTarget({ tab: "docs" })).toEqual({ tab: "docs", docsFilter: null });
  });

  it("journal 深链:只落回顾页签,不动文档过滤", () => {
    expect(deepLinkTarget({ tab: "journal", review: { view: "footprint" } }))
      .toEqual({ tab: "journal" });
  });

  it("无 payload / 未知 tab:返回 null", () => {
    expect(deepLinkTarget(null)).toBeNull();
    expect(deepLinkTarget({})).toBeNull();
    expect(deepLinkTarget({ tab: "board" })).toBeNull();
  });
});
