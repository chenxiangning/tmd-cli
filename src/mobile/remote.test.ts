import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachShot, composeSendText, pickResultToBlob, tailAskLine } from "./remote";

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

  it("source 标注图源:takePhoto 失败信息带 takePhoto", () => {
    expect(() => pickResultToBlob({}, "takePhoto")).toThrow("takePhoto 回传无图片数据");
  });

  it("有 b64 → JPEG Blob", () => {
    const blob = pickResultToBlob({ b64: btoa(bin) });
    expect(blob?.type).toBe("image/jpeg");
  });
});

describe("attachShot(pending 生命周期:原图即时预览 → 完成/失败收口)", () => {
  /* node 无 createObjectURL:stub 全局 URL(attachShot 只用这两个静态方法) */
  const createObjectURL = vi.fn((b: Blob) => `blob:${b.size}`);
  const revokeObjectURL = vi.fn();
  const file = new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });
  const shrink = async () => new Uint8Array([9]);

  beforeEach(() => {
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("成功:原图到手即 onPending → 落盘 onShot → onPendingDone 撤卡,预览 URL 释放", async () => {
    const ev: string[] = [];
    await attachShot(
      {
        isBusy: false,
        setBusy: (v) => ev.push(v ? "busy" : "idle"),
        onShot: (s) => ev.push(`shot:${s.path}:${s.url}`),
        flashErr: (v) => ev.push(`err:${v}`),
        onPending: (u) => ev.push(`pending:${u}`),
        onPendingDone: () => ev.push("pendingDone"),
      },
      { pick: () => file, shrink, upload: async () => "/tmp/shot-1.jpg" },
    );
    /* blob:3 = 原图(3B)预览;blob:1 = 压缩后(1B)终态缩略 —— pending 先于上传完成 */
    expect(ev).toEqual(["busy", "pending:blob:3", "shot:/tmp/shot-1.jpg:blob:1", "pendingDone", "idle"]);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:3");
  });

  it("失败(相册):pending 撤卡 + flashErr(album),3s 自清为 null", async () => {
    vi.useFakeTimers();
    try {
      const ev: string[] = [];
      await attachShot(
        {
          isBusy: false,
          setBusy: () => undefined,
          onShot: () => ev.push("shot"),
          flashErr: (v) => ev.push(`err:${v}`),
          onPending: () => ev.push("pending"),
          onPendingDone: () => ev.push("pendingDone"),
        },
        { pick: () => file, shrink, upload: async () => { throw new Error("bridge down"); } },
      );
      expect(ev).toEqual(["pending", "pendingDone", "err:album"]);
      vi.advanceTimersByTime(3000);
      expect(ev).toEqual(["pending", "pendingDone", "err:album", "err:null"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("失败(source=camera):错误条分档 camera", async () => {
    vi.useFakeTimers();
    try {
      const errs: string[] = [];
      await attachShot(
        {
          isBusy: false,
          setBusy: () => undefined,
          onShot: () => undefined,
          flashErr: (v) => errs.push(String(v)),
          onPending: () => undefined,
          onPendingDone: () => undefined,
        },
        { source: "camera", pick: () => file, shrink, upload: async () => { throw new Error("x"); } },
      );
      expect(errs).toEqual(["camera"]);
      vi.advanceTimersByTime(3000);
      expect(errs).toEqual(["camera", "null"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("取消(picker 回 null):静默 —— 无 pending 无错误,预览 URL 不创建", async () => {
    const ev: string[] = [];
    await attachShot(
      {
        isBusy: false,
        setBusy: (v) => ev.push(v ? "busy" : "idle"),
        onShot: () => ev.push("shot"),
        flashErr: (v) => ev.push(`err:${v}`),
        onPending: () => ev.push("pending"),
        onPendingDone: () => ev.push("pendingDone"),
      },
      { pick: () => null },
    );
    expect(ev).toEqual(["busy", "idle"]);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("busy 闸:isBusy=true 直返,不触图源不置忙", async () => {
    const ev: string[] = [];
    await attachShot(
      {
        isBusy: true,
        setBusy: () => ev.push("set"),
        onShot: () => ev.push("shot"),
        flashErr: (v) => ev.push(`err:${v}`),
      },
      { pick: () => { ev.push("pick"); return file; } },
    );
    expect(ev).toEqual([]);
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
