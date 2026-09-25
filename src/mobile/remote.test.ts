import { describe, expect, it } from "vitest";
import { tailAskLine } from "./remote";

describe("tailAskLine", () => {
  it("剥 ANSI 后取最后一条命中标记的原文行(ask 卡正文)", async () => {
    const tail =
      "\u001b]0;claude\u0007building…\n● 需要权限: \u001b[1mpnpm build\u001b[0m\nDo you want to proceed? [y/n] ";
    expect(await tailAskLine(tail)).toBe("Do you want to proceed? [y/n]");
  });

  it("无标记 → null", async () => {
    expect(await tailAskLine("waiting for input…\n")).toBeNull();
  });
});
