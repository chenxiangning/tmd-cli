/** LiveTurn 纯逻辑测试:实时输出尾窗钳制。 */
import { describe, expect, it } from "vitest";
import { tailLines } from "@plugins/session-viewer/transcriptPhases";

describe("tailLines 运行中输出尾窗钳制", () => {
  it("超限只留末 N 行,不足整段直通", () => {
    const detail = Array.from({ length: 60 }, (_, i) => `L${i}`).join("\n");
    expect(tailLines(detail, 40)).not.toContain("L0\n");
    expect(tailLines(detail, 40)).toContain("L59");
    expect(tailLines("a\nb", 40)).toBe("a\nb");
  });
});
