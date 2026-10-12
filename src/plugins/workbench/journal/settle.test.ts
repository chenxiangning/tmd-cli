/**
 * 生成结算判据单测:articleChanged(2026-10-13 假成功修复)。
 * 旧判据只认「文件存在」,并入型任务开跑即成功 → 生成会话被收割、水位被推,
 * 全天增量并入空转。新判据 = 全文相对基线真的变化。
 */
import { describe, expect, it } from "vitest";
import { articleChanged } from "./journalFiles";

describe("articleChanged 结算判据", () => {
  it("首次提取:基线 null,文章落盘才算变化", () => {
    expect(articleChanged(null, "# 标题")).toBe(true);
    expect(articleChanged(null, null)).toBe(false);
  });

  it("增量并入:内容不同才算变化;只存在不变化 = 假成功,判 false", () => {
    expect(articleChanged("# 旧文", "# 旧文\n## 新节")).toBe(true);
    expect(articleChanged("# 旧文", "# 旧文")).toBe(false);
  });

  it("文章被删或零字节(baseline 有值,next null/\"\")不判成功", () => {
    expect(articleChanged("# 旧文", null)).toBe(false);
    expect(articleChanged(null, "")).toBe(false);
  });
});
