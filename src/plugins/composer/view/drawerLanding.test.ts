/**
 * 抽屉落位裁决契约测试 —— 可见响应优先(2026-09-28 真机反馈返工后语义)。
 * 守护:开帧/未解析都立即落意图(点击必有可见反馈,不出现「点了没动静」);
 * 终拍空区回落「全部」;切 profile 归一;手动切 tab 不被回拉。
 */
import { describe, expect, it } from "vitest";
import { nextDrawerTab } from "./drawerLanding";

const NO = { tab: "all" as const, want: null, resolved: false, sections: [], fresh: false };

describe("nextDrawerTab", () => {
  it("开帧:有意图先落意图分区,无意图落全部", () => {
    expect(nextDrawerTab({ ...NO, want: "skill", fresh: true, sections: [] })).toBe("skill");
    expect(nextDrawerTab({ ...NO, fresh: true })).toBe("all");
  });

  it("claude 形状(静态拍无技能条目):未解析也立即落位,空区显「暂无」也是可见响应", () => {
    expect(
      nextDrawerTab({ tab: "all", want: "skill", resolved: false, sections: [], fresh: false }),
    ).toBe("skill");
  });

  it("终拍:意图分区有条目则保持;空区回落「全部」(兜底可见校正)", () => {
    expect(
      nextDrawerTab({ tab: "skill", want: "skill", resolved: true, sections: ["command", "skill"], fresh: false }),
    ).toBeNull();
    expect(
      nextDrawerTab({ tab: "skill", want: "skill", resolved: true, sections: ["command"], fresh: false }),
    ).toBe("all");
  });

  it("未解析但当前数据已含分区(缓存命中):落位(与立即落位同向)", () => {
    expect(
      nextDrawerTab({ tab: "all", want: "mcp", resolved: false, sections: ["command", "mcp"], fresh: false }),
    ).toBe("mcp");
  });

  it("无意图:解析完成后 tab 不在新 sections(切 profile)→ 归一全部;仍在则不动", () => {
    expect(nextDrawerTab({ tab: "mcp", want: null, resolved: true, sections: ["command"], fresh: false })).toBe("all");
    expect(nextDrawerTab({ tab: "mcp", want: null, resolved: true, sections: ["mcp"], fresh: false })).toBeNull();
    expect(nextDrawerTab({ ...NO, tab: "all" })).toBeNull();
  });

  it("已开@A 点轨图标 B:立即切 B(不等解析);手切 tab 后意图同步,幂等不动", () => {
    expect(
      nextDrawerTab({ tab: "mcp", want: "skill", resolved: false, sections: ["skill"], fresh: false }),
    ).toBe("skill");
    expect(
      nextDrawerTab({ tab: "skill", want: "skill", resolved: true, sections: ["skill", "mcp"], fresh: false }),
    ).toBeNull();
  });
});
