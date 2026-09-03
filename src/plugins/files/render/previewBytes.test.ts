/**
 * 二进制字节通道契约测试:base64 解码(含分块路径/空白/padding)、
 * data URL 字节数推算、缓存命中与去重(mock ipc)。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const readBinaryFileBase64 = vi.fn(async (path: string) => {
  if (path === "/x/missing.pdf") {
    throw new Error("读取文件信息失败: no such file");
  }
  /* "hello" 的 base64 */
  return Buffer.from("hello").toString("base64");
});

vi.mock("@kernel/ipc", () => ({
  ipc: { readBinaryFileBase64: (path: string) => readBinaryFileBase64(path) },
}));

import {
  clearPreviewBytesCacheForTests,
  dataUrlByteLength,
  decodeBase64ToBytes,
  loadPreviewBytes,
} from "./previewBytes";

function bytesToText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

describe("decodeBase64ToBytes", () => {
  it("基础往返 + padding 处理", () => {
    expect(bytesToText(decodeBase64ToBytes(Buffer.from("hello").toString("base64")))).toBe("hello");
    expect(decodeBase64ToBytes("aGVsbG8h").byteLength).toBe(6); /* "hello!" */
    expect(decodeBase64ToBytes("aGVsbG8=").byteLength).toBe(5); /* "hello" */
    expect(decodeBase64ToBytes("aGVsbA==").byteLength).toBe(4); /* "hell" */
  });

  it("超长输入走分块路径:结果与整体解码一致", () => {
    const payload = "x".repeat(200_000);
    const encoded = Buffer.from(payload).toString("base64");
    expect(bytesToText(decodeBase64ToBytes(encoded))).toBe(payload);
  });

  it("容忍 base64 中的换行空白", () => {
    const encoded = Buffer.from("ab\ncd").toString("base64");
    expect(bytesToText(decodeBase64ToBytes(encoded.replace(/(.{4})/g, "$1\n")))).toBe("ab\ncd");
  });
});

describe("dataUrlByteLength", () => {
  it("base64 data URL:按 payload 推算;非 data:/非 base64 返回 null", () => {
    const b64 = Buffer.from("hello!!").toString("base64"); // 7 字节 → 12 字符 + "==" padding
    expect(dataUrlByteLength(`data:image/png;base64,${b64}`)).toBe(7);
    expect(dataUrlByteLength("https://example.com/a.png")).toBeNull();
    expect(dataUrlByteLength("data:text/plain,hello")).toBeNull();
  });
});

describe("loadPreviewBytes", () => {
  beforeEach(() => {
    readBinaryFileBase64.mockClear();
    clearPreviewBytesCacheForTests();
  });

  it("缓存命中:同路径第二次读取不再走 ipc", async () => {
    const first = await loadPreviewBytes("/x/a.pdf");
    const second = await loadPreviewBytes("/x/a.pdf");
    expect(readBinaryFileBase64).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(bytesToText(first)).toBe("hello");
  });

  it("在途去重:并发请求只触发一次 ipc", async () => {
    const [a, b] = await Promise.all([
      loadPreviewBytes("/x/b.pdf"),
      loadPreviewBytes("/x/b.pdf"),
    ]);
    expect(readBinaryFileBase64).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it("失败向上抛且不污染缓存", async () => {
    await expect(loadPreviewBytes("/x/missing.pdf")).rejects.toThrow("读取文件信息失败");
    await expect(loadPreviewBytes("/x/missing.pdf")).rejects.toThrow();
    expect(readBinaryFileBase64).toHaveBeenCalledTimes(2);
  });
});
