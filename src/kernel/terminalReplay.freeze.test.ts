import { describe, expect, it, vi } from "vitest";
import type { LoadProgress } from "./terminalReplay";

/** host mock:可控事件 emitter + 缓冲/字节水位/会话元表(指纹来源)。 */
const hoisted = vi.hoisted(() => ({
  listeners: new Map<string, Array<(t: string) => void>>(),
  buffers: new Map<string, string>(),
  metas: new Map<string, { pid?: number; createdAt?: number } | undefined>(),
}));

vi.mock("@kernel/host", () => ({
  ptyLiveTopic: (id: string) => `pty://out/${id}`,
  host: {
    events: {
      on: (topic: string, cb: (t: string) => void) => {
        const arr = hoisted.listeners.get(topic) ?? [];
        arr.push(cb);
        hoisted.listeners.set(topic, arr);
        return () => hoisted.listeners.set(topic, (hoisted.listeners.get(topic) ?? []).filter((f) => f !== cb));
      },
    },
    getOutputBuffer: (id: string) => hoisted.buffers.get(id) ?? null,
    getOutputBufferBytes: (id: string) => new TextEncoder().encode(hoisted.buffers.get(id) ?? "").length,
    getSessions: () => [...hoisted.metas.entries()].map(([id, meta]) => ({ id, pid: meta?.pid, createdAt: meta?.createdAt })),
    getCliSessionId: () => undefined,
    observeReplayTail: () => undefined,
    restoreDiskTail: () => undefined,
  },
}));

vi.mock("./diskReplay", () => ({ consumeDiskTail: () => null }));

import { attachTerminalStream } from "./terminalReplay";
import { createReplayInputGate } from "./terminalInputGate";
import { saveTerminalFreeze } from "./terminalFreeze";

/** 假终端:记录写入,回调走微任务模拟 xterm 异步解析。 */
function fakeTerm() {
  const writes: string[] = [];
  return {
    writes,
    write(data: string, cb?: () => void) {
      writes.push(data);
      queueMicrotask(() => cb?.());
    },
  };
}

function emit(id: string, text: string): void {
  for (const cb of hoisted.listeners.get(`pty://out/${id}`) ?? []) cb(text);
}

/** 存一份与缓冲前缀同拍的挤除快照。 */
function seedFreeze(id: string, unload: string, fingerprint: string, screenText: string): void {
  saveTerminalFreeze({
    sessionId: id,
    cols: 80,
    rows: 24,
    screenText,
    unloadChars: unload.length,
    bytePos: new TextEncoder().encode(unload).length,
    headSample: unload,
    fingerprint,
    at: 1,
  });
}

describe("attachTerminalStream 挤除冻结快照路径", () => {
  it("命中:投影同步上屏 + 卸载水位起增量补写,免全量重写免遮罩,就绪即时收口", async () => {
    const UNLOAD = "旧屏内容";
    const APPEND = "增量A";
    hoisted.metas.set("fh1", { pid: 7, createdAt: 5 });
    hoisted.buffers.set("fh1", UNLOAD + APPEND);
    seedFreeze("fh1", UNLOAD, "7:5", "[SCREEN]");

    const term = fakeTerm();
    const gate = createReplayInputGate();
    const progress: LoadProgress[] = [];
    const onReady = vi.fn();
    const off = attachTerminalStream(term, "fh1", gate, (p) => progress.push(p), onReady);
    emit("fh1", "LIVE"); // 补写完成前的新 chunk:走攒队,尽后按序补写一次

    await vi.waitFor(() => expect(term.writes.join("")).toContain("LIVE"));
    expect(term.writes[0]).toBe("[SCREEN]"); // 投影先行(同步上屏)
    expect(term.writes.join("")).toBe("[SCREEN]" + APPEND + "LIVE");
    expect(term.writes.join("")).not.toContain(UNLOAD); // 全量回放已跳过
    expect(progress).toEqual([null]); // 零遮罩:直接就绪撤罩
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(gate.blocked()).toBe(false); // 启动闸收口,无泄漏

    off();
    const after = term.writes.length;
    emit("fh1", "TAIL");
    expect(term.writes.length).toBe(after); // 卸载解绑
  });

  it("指纹不匹配(同 id 重 spawn)弃快照:走既有全量回放带进度遮罩", async () => {
    const UNLOAD = "另一屏内容";
    hoisted.metas.set("fh2", { pid: 9, createdAt: 9 }); // 与快照指纹 7:5 不符
    hoisted.buffers.set("fh2", UNLOAD + "增量B");
    seedFreeze("fh2", UNLOAD, "7:5", "[STALE]");

    const term = fakeTerm();
    const gate = createReplayInputGate();
    const progress: LoadProgress[] = [];
    const off = attachTerminalStream(term, "fh2", gate, (p) => progress.push(p));

    await vi.waitFor(() => expect(term.writes.join("")).toContain(UNLOAD));
    expect(term.writes.join("")).toBe(UNLOAD + "增量B"); // 全缓冲重写,投影未上屏
    expect(term.writes.join("")).not.toContain("[STALE]");
    expect(progress[0]).toEqual({ kind: "replay", pct: 0 });
    off();
  });
});
