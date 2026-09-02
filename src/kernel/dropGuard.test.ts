/**
 * dropGuard 行为契约测试。
 * 覆盖:含 Files 的拖拽三事件(dragenter/dragover/drop)一律 preventDefault、
 * 非 Files 拖拽(纯文本/附件重排)不动默认行为、返回的清理函数真实卸载监听。
 * node 环境无 DragEvent,以 Event + 注入 dataTransfer 桩派发;
 * 模块级单例,每个用例经 vi.resetModules + 动态 import 取全新实例。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type DropGuardModule = typeof import("./dropGuard");

let dropGuard: DropGuardModule;

/** 派发一个带 dataTransfer 桩的可取消事件,返回派发后的 defaultPrevented。 */
function fire(target: EventTarget, type: string, types: string[]): boolean {
  const e = new Event(type, { cancelable: true, bubbles: true });
  Object.defineProperty(e, "dataTransfer", { value: { types } });
  target.dispatchEvent(e);
  return e.defaultPrevented;
}

describe("bootDropGuard", () => {
  beforeEach(async () => {
    vi.resetModules();
    dropGuard = await import("./dropGuard");
  });

  it("含 Files 的 dragenter/dragover/drop 一律 preventDefault(阻断导航开文件)", () => {
    const target = new EventTarget();
    dropGuard.bootDropGuard(target);
    for (const type of ["dragenter", "dragover", "drop"]) {
      expect(fire(target, type, ["Files"])).toBe(true);
    }
  });

  it("非 Files 拖拽(纯文本/附件重排)不取消默认行为", () => {
    const target = new EventTarget();
    dropGuard.bootDropGuard(target);
    for (const type of ["dragenter", "dragover", "drop"]) {
      expect(fire(target, type, ["text/plain"])).toBe(false);
    }
  });

  it("清理函数卸载监听,之后恢复默认行为", () => {
    const target = new EventTarget();
    const dispose = dropGuard.bootDropGuard(target);
    dispose();
    expect(fire(target, "drop", ["Files"])).toBe(false);
  });
});
