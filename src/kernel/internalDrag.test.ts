/**
 * internalDrag 契约(文件树 → composer 的内核级拖拽通道,模块级单例):
 * setDragPayload 写入后 readDragPayload 返回同一 payload;再次 set 覆写旧值;
 * clearDragPayload 后读回 null;初始态与重复 clear 同为 null(读时无副作用)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/* 动态 import 例外:pending 挂在模块级单例上,静态 import 无法跨用例重置。 */
const load = (): Promise<typeof import("./internalDrag")> => import("./internalDrag");

beforeEach(() => {
  vi.resetModules();
});

describe("internalDrag", () => {
  it("set 后 read 返回同一 payload(对象引用一致)", async () => {
    const mod = await load();
    const payload = { path: "/tmp/a.txt", isDir: false, name: "a.txt" };
    mod.setDragPayload(payload);
    expect(mod.readDragPayload()).toBe(payload);
  });

  it("再次 set 覆写旧 payload", async () => {
    const mod = await load();
    mod.setDragPayload({ path: "/tmp/a", isDir: false, name: "a" });
    const second = { path: "/tmp/dir", isDir: true, name: "dir" };
    mod.setDragPayload(second);
    expect(mod.readDragPayload()).toBe(second);
  });

  it("clear 后读回 null;初始态与重复 clear 同为 null", async () => {
    const mod = await load();
    expect(mod.readDragPayload()).toBeNull();

    mod.setDragPayload({ path: "/tmp/a", isDir: false, name: "a" });
    mod.clearDragPayload();
    expect(mod.readDragPayload()).toBeNull();

    mod.clearDragPayload();
    expect(mod.readDragPayload()).toBeNull();
  });
});
