import { describe, expect, it } from "vitest";
import { fnv1a32, hashStableString } from "./textHash";

describe("textHash", () => {
  it("fnv1a32 与 FNV-1a 32 位标准向量一致", () => {
    expect(fnv1a32("")).toBe(0x811c9dc5);
    expect(fnv1a32("a")).toBe(0xe40c292c);
    expect(fnv1a32("foobar")).toBe(0xbf9cf968);
  });

  it("hashStableString 确定性且可区分", () => {
    expect(hashStableString("abc")).toBe(hashStableString("abc"));
    expect(hashStableString("abc")).not.toBe(hashStableString("abd"));
  });
});
