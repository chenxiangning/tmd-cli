/**
 * overlapLen 契约:活流「先订阅后快照」的防双喂纯函数。
 * 订阅生效→快照读取窗口内到达的 chunk 同时存在于快照尾与缓冲头,排空前
 * 剥掉重叠前缀;差分重绘型 CLI(opencode)对双喂不幂等,重复即上屏(实证)。
 */
import { describe, expect, it } from "vitest";
import { overlapLen } from "./useLiveStream";

describe("overlapLen 快照尾×缓冲头剥离", () => {
  it("缓冲全含于快照尾:整段剥掉,余 0", () => {
    expect(overlapLen("frame-A\nframe-B\n", "frame-B\n")).toBe("frame-B\n".length);
  });

  it("缓冲半含于快照:剥重叠前缀,后缀保留", () => {
    const tail = "line1\nline2\n";
    const pending = "line2\nline3\n"; /* line2 在窗口内到达,line3 在快照读取后 */
    expect(overlapLen(tail, pending)).toBe("line2\n".length);
  });

  it("无重叠:0,缓冲原样排空", () => {
    expect(overlapLen("aaa\n", "bbb\n")).toBe(0);
  });

  it("最长后缀匹配优先(重复纹理不误剥)", () => {
    /* tail 结尾 "ab"、pending 以 "abab" 开头:真实重叠是 2,不是 4(tail 没那么长)也不是 0。 */
    expect(overlapLen("xxab", "abab")).toBe(2);
  });

  it("空输入:0", () => {
    expect(overlapLen("", "x")).toBe(0);
    expect(overlapLen("x", "")).toBe(0);
  });
});
