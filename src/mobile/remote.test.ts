import { describe, expect, it } from "vitest";
import { composeSendText, pickResultToBlob, tailAskLine } from "./remote";

describe("pickResultToBlob(native pickImage 结果分流)", () => {
  const raw = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  let bin = "";
  for (const b of raw) bin += String.fromCharCode(b);

  it("用户取消(cancelled)→ null,不当失败", () => {
    expect(pickResultToBlob({ cancelled: true })).toBeNull();
  });

  it("失败无 b64 → throw 带原因(供 flashErr 上屏,不再静默)", () => {
    expect(() => pickResultToBlob({})).toThrow("pickImage 回传无图片数据");
    expect(() => pickResultToBlob({ b64: "" })).toThrow();
  });

  it("有 b64 → JPEG Blob", () => {
    const blob = pickResultToBlob({ b64: btoa(bin) });
    expect(blob?.type).toBe("image/jpeg");
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

describe("composeSendText(正文 + 已挂图片统一拼 @路径)", () => {
  it("正文带尾空白 + 单图 → 单空格接 @路径", () => {
    expect(composeSendText("看下这个 ", ["/tmp/a.jpg"])).toBe("看下这个 @/tmp/a.jpg");
  });

  it("纯图片无正文 → 仅 @路径串(空格分隔)", () => {
    expect(composeSendText("", ["/a.jpg", "/b.jpg"])).toBe("@/a.jpg @/b.jpg");
  });

  it("空草稿且无图 → null 不发送", () => {
    expect(composeSendText("  ", [])).toBeNull();
  });
});
