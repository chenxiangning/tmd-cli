/**
 * files 插件小模块契约测试(同目录小兄弟模块并入本文件,头注释列明):
 *
 * markBridge —— md 预览标注桥(经内核事件总线与 marks 插件协作,主题契约):
 *   · 未注入总线时发射函数静默不抛;
 *   · requestFileMark/emitFileMarkAction 按 "file-mark:request"/"file-mark:action"
 *     主题原载荷发射;
 *   · changed 馈送更新缓存并分发给全部本地订阅者(同引用透传);
 *   · subscribeFileMarks 订阅即同步回放当前缓存(激活序竞态免疫),退订即断;
 *   · 重复注入先退旧订阅,旧总线推送不再生效(不叠加)。
 * treeHandles —— FileTree 动作句柄注册表:默认空、上交可读回、覆盖替换、置 null 断开。
 * fileVisual —— 默认视觉 provider:order 100 兜底优先级;文字色恒灰;
 *   svgHtml 委托图标表(目录开合换造型、文件按扩展名映射)。
 * editor/editorChromeLogic —— 工具条状态文案优先级:远程只读 > 错误 >
 *   保存中 > 脏 > 已保存;toolbarCls 错误/脏着色组合。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginEventBus } from "@kernel/plugin";
import type { FileMarkLite, FileMarkMap } from "./markBridge";
type MarkBridgeNS = typeof import("./markBridge");
type TreeHandlesNS = typeof import("./treeHandles");
import { statusText, toolbarCls } from "./editor/editorChromeLogic";
import { defaultFileVisualProvider } from "./fileVisual";

let markBridge: MarkBridgeNS;
let treeHandles: TreeHandlesNS;

/* 最小事件总线桩:记录注册与发射,emit 同步分发同 topic 订阅者;off 真退订。 */
function fakeBus() {
  type Sub = { topic: string; handler: (p: any) => void; off: () => void };
  const subs: Sub[] = [];
  const emitted: Array<{ topic: string; payload: unknown }> = [];
  const bus: PluginEventBus = {
    on(topic, handler) {
      const sub: Sub = {
        topic,
        handler,
        off: () => {
          const i = subs.indexOf(sub);
          if (i >= 0) subs.splice(i, 1);
        },
      };
      subs.push(sub);
      return sub.off;
    },
    emit(topic, payload) {
      emitted.push({ topic, payload });
      for (const s of [...subs]) if (s.topic === topic) s.handler(payload);
    },
  };
  return { bus, subs, emitted };
}

const lite = (id: string): FileMarkLite => ({
  id,
  startLine: 1,
  endLine: 2,
  note: "",
  state: "staged",
  stateLabel: "已暂存",
});

beforeEach(async () => {
  vi.resetModules();
  // 动态 import 例外:markBridge/treeHandles 为模块级单例(可变模块态),
  // 必须借 resetModules + 动态 import 取全新实例,静态 import 做不到(同 terminalLinks.test.ts 范式)。
  markBridge = await import("./markBridge");
  treeHandles = await import("./treeHandles");
});

describe("markBridge(标注桥注册与分发)", () => {
  it("未注入总线时发射函数静默不抛", () => {
    expect(() => {
      markBridge.requestFileMark({ path: "a.md", startLine: 1, endLine: 1 });
      markBridge.emitFileMarkAction({ id: "m1", op: "remove" });
    }).not.toThrow();
  });

  it("requestFileMark 按 file-mark:request 主题原载荷发射", () => {
    const f = fakeBus();
    markBridge.setFileMarkBus(f.bus);
    const req = { path: "src/x.md", startLine: 3, endLine: 5 };
    markBridge.requestFileMark(req);
    expect(f.emitted).toEqual([{ topic: "file-mark:request", payload: req }]);
  });

  it("emitFileMarkAction 按 file-mark:action 主题发射动作载荷", () => {
    const f = fakeBus();
    markBridge.setFileMarkBus(f.bus);
    const action = { id: "m1", op: "stage" as const };
    markBridge.emitFileMarkAction(action);
    expect(f.emitted).toEqual([{ topic: "file-mark:action", payload: action }]);
  });

  it("changed 馈送更新缓存并分发给全部订阅者,同引用透传", () => {
    const f = fakeBus();
    markBridge.setFileMarkBus(f.bus);
    const seenA: FileMarkMap[] = [];
    const seenB: FileMarkMap[] = [];
    markBridge.subscribeFileMarks((m) => seenA.push(m));
    markBridge.subscribeFileMarks((m) => seenB.push(m));
    const marks = { "a.md": [lite("m1")] };
    f.bus.emit("file-mark:changed", marks);
    expect(seenA).toHaveLength(2); // 初始回放 + 馈送
    expect(seenA[1]).toBe(marks);
    expect(seenB[1]).toBe(marks);
  });

  it("订阅即同步回放当前缓存(激活序竞态免疫)", () => {
    const f = fakeBus();
    markBridge.setFileMarkBus(f.bus);
    const marks = { "a.md": [lite("m1")] };
    f.bus.emit("file-mark:changed", marks);
    const seen: FileMarkMap[] = [];
    markBridge.subscribeFileMarks((m) => seen.push(m));
    expect(seen).toEqual([marks]); // 不必等下一次馈送即可拿到最新表
  });

  it("退订后不再接收 changed 分发", () => {
    const f = fakeBus();
    markBridge.setFileMarkBus(f.bus);
    const seen: FileMarkMap[] = [];
    const off = markBridge.subscribeFileMarks((m) => seen.push(m));
    off();
    f.bus.emit("file-mark:changed", { "a.md": [] });
    expect(seen).toHaveLength(1); // 只剩初始回放
  });

  it("重复注入先退旧订阅:旧总线推送失效,新总线生效", () => {
    const first = fakeBus();
    markBridge.setFileMarkBus(first.bus);
    const seen: FileMarkMap[] = [];
    markBridge.subscribeFileMarks((m) => seen.push(m));
    const second = fakeBus();
    markBridge.setFileMarkBus(second.bus);
    expect(first.subs).toHaveLength(0); // 旧总线上的订阅已退
    first.bus.emit("file-mark:changed", { "old.md": [lite("stale")] });
    expect(seen).toHaveLength(1); // 旧推送不触达
    const fresh = { "new.md": [lite("fresh")] };
    second.bus.emit("file-mark:changed", fresh);
    expect(seen).toHaveLength(2);
    expect(seen[1]).toBe(fresh);
  });
});

describe("treeHandles(挂载句柄注册表)", () => {
  it("未挂载 FileTree 时读口为 null,外壳按钮据此无操作", () => {
    expect(treeHandles.getActiveTreeHandles()).toBeNull();
  });

  it("上交后读回同一引用;覆盖注册取最新;置 null 即断开", () => {
    const h1 = { reload: async () => {}, newFile: () => {}, newFolder: () => {} };
    treeHandles.setActiveTreeHandles(h1);
    expect(treeHandles.getActiveTreeHandles()).toBe(h1);
    const h2 = { reload: async () => {}, newFile: () => {}, newFolder: () => {} };
    treeHandles.setActiveTreeHandles(h2);
    expect(treeHandles.getActiveTreeHandles()).toBe(h2);
    treeHandles.setActiveTreeHandles(null);
    expect(treeHandles.getActiveTreeHandles()).toBeNull();
  });
});

describe("fileVisual(默认视觉 provider)", () => {
  it("order=100 兜底;文字色恒为灰色类,不随文件类型/目录态变化", () => {
    expect(defaultFileVisualProvider.order).toBe(100);
    expect(defaultFileVisualProvider.match("a.ts", false)!.colorClass).toBe(
      defaultFileVisualProvider.match("src", true, true)!.colorClass,
    );
  });

  it("svgHtml 委托图标表:目录开合换造型,文件按扩展名映射品牌图标", () => {
    const closed = defaultFileVisualProvider.match("src", true, false)!.svgHtml;
    const open = defaultFileVisualProvider.match("src", true, true)!.svgHtml;
    expect(open).not.toBe(closed); // 展开换开口造型
    expect(defaultFileVisualProvider.match("a.ts", false)!.svgHtml).toContain("TS");
    expect(defaultFileVisualProvider.match("a.ts", false)!.svgHtml).not.toBe(
      defaultFileVisualProvider.match("a.js", false)!.svgHtml,
    );
    // 未知扩展回落基础文件形,与目录/已知品牌图标均不同
    const unknown = defaultFileVisualProvider.match("a.unknownext", false)!.svgHtml;
    expect(unknown).not.toBe(closed);
    expect(unknown).not.toBe(defaultFileVisualProvider.match("a.md", false)!.svgHtml);
  });
});

describe("editorChromeLogic(编辑器壳纯逻辑)", () => {
  const doc = (over: Partial<{ error: string | null; saving: boolean; dirty: boolean }> = {}) => ({
    error: null,
    saving: false,
    dirty: false,
    ...over,
  });

  it("statusText 优先级:远程只读压过一切本地态", () => {
    expect(statusText(doc({ error: "boom", saving: true, dirty: true }), true)).toBe(
      "远程文件 · 只读(M1)",
    );
  });

  it("statusText:错误 > 保存中 > 脏 > 已保存", () => {
    expect(statusText(doc({ error: "boom", saving: true, dirty: true }), false)).toBe("boom");
    expect(statusText(doc({ saving: true, dirty: true }), false)).toBe("保存中…");
    expect(statusText(doc({ dirty: true }), false)).toBe("● 未保存的更改 · ⌘S 保存");
    expect(statusText(doc(), false)).toBe("已保存");
  });

  it("toolbarCls:错误优先于脏,并存时只着错误色不叠加", () => {
    expect(toolbarCls(null, false)).toBe("file-editor-toolbar");
    expect(toolbarCls("boom", false)).toBe("file-editor-toolbar is-error");
    expect(toolbarCls(null, true)).toBe("file-editor-toolbar is-dirty");
    expect(toolbarCls("boom", true)).toBe("file-editor-toolbar is-error");
  });
});
