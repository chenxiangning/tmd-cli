import { describe, expect, it } from "vitest";
import { blobFromB64, tailAskLine } from "./remote";

describe("blobFromB64(native pickImage 回传还原)", () => {
  it("base64 → JPEG Blob,字节保真", async () => {
    const raw = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    let bin = "";
    for (const b of raw) bin += String.fromCharCode(b);
    const blob = blobFromB64(btoa(bin));
    expect(blob.type).toBe("image/jpeg");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(raw);
  });
});

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
