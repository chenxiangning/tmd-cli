/** findAnchorFull 末次现行语义(0.4.2 发版评审 P3 留观收编:重复锚文取首现行会锚到偏高旧帧)。 */
import { describe, expect, it } from "vitest";
import { findAnchorFull } from "../terminalScrollAnchor";

/** 假缓冲:行数组 → AnchorBuffer 同构面。 */
function buf(lines: string[]) {
  return {
    length: lines.length,
    getLine: (row: number) =>
      row >= 0 && row < lines.length ? { translateToString: () => lines[row] } : undefined,
  };
}

describe("findAnchorFull", () => {
  it("唯一锚文取其行", () => {
    expect(findAnchorFull(buf(["alpha", "beta gamma", "delta"]), "beta gamma")).toBe(1);
  });

  it("重复锚文取末次现行(重印帧取最新,不锚偏高旧帧)", () => {
    expect(findAnchorFull(buf(["hdr one", "mid", "hdr one", "tail"]), "hdr one")).toBe(2);
  });

  it("折行空白的行归一后仍可命中", () => {
    expect(findAnchorFull(buf(["x", "hdr   one"]), "hdr one")).toBe(1);
  });

  it("未命中返回 -1", () => {
    expect(findAnchorFull(buf(["a", "b"]), "zzz")).toBe(-1);
  });
});
