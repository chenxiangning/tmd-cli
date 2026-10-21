/** git 状态语义判定单测:porcelain 字母全量映射与未知兜底。 */
import { describe, expect, it } from "vitest";
import { gitStatusSemantic } from "./gitStatusColor";

describe("gitStatusSemantic", () => {
  it("全量字母映射", () => {
    expect(gitStatusSemantic("A")).toBe("added");
    expect(gitStatusSemantic("D")).toBe("deleted");
    expect(gitStatusSemantic("C")).toBe("deleted");
    expect(gitStatusSemantic("M")).toBe("modified");
    expect(gitStatusSemantic("R")).toBe("renamed");
    expect(gitStatusSemantic("T")).toBe("renamed");
    expect(gitStatusSemantic("?")).toBe("untracked");
  });

  it("未知字母兜底 modified(审查态)", () => {
    expect(gitStatusSemantic("X")).toBe("modified");
    expect(gitStatusSemantic("")).toBe("modified");
  });
});
