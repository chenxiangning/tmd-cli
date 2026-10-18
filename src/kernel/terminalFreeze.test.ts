import { describe, expect, it } from "vitest";
import {
  HEAD_SAMPLE_CHARS,
  resolveFreezeReplay,
  saveTerminalFreeze,
  sessionFreezeFingerprint,
  takeTerminalFreeze,
  type TerminalFreezeSnapshot,
} from "./terminalFreeze";

const enc = new TextEncoder();
const bytesOf = (s: string): number => enc.encode(s).length;

/** 快照装配:缺省字段填合法值,用例只声明关注面。 */
function snap(partial: Partial<TerminalFreezeSnapshot> & { sessionId: string }): TerminalFreezeSnapshot {
  return {
    cols: 80,
    rows: 24,
    screenText: "SCREEN",
    cursorX: 0,
    cursorY: 0,
    unloadChars: 0,
    bytePos: 0,
    headSample: "",
    fingerprint: "7:5",
    at: 1,
    ...partial,
  };
}

describe("快照存档 LRU", () => {
  it("档位 8:第 9 个存档逐出最旧", () => {
    for (const id of ["fz-a", "fz-b", "fz-c", "fz-d", "fz-e", "fz-f", "fz-g", "fz-h", "fz-i"]) {
      saveTerminalFreeze(snap({ sessionId: id }));
    }
    expect(takeTerminalFreeze("fz-a")).toBeNull();
    expect(takeTerminalFreeze("fz-b")).not.toBeNull();
  });

  it("同会话重存刷新新度:逐出次旧而非它", () => {
    for (const id of ["fr-a", "fr-b", "fr-c", "fr-d", "fr-e", "fr-f", "fr-g", "fr-h"]) {
      saveTerminalFreeze(snap({ sessionId: id }));
    }
    saveTerminalFreeze(snap({ sessionId: "fr-a" })); // 最旧复活为新
    saveTerminalFreeze(snap({ sessionId: "fr-i" })); // 第 9 个 → 逐出 fr-b
    expect(takeTerminalFreeze("fr-b")).toBeNull();
    expect(takeTerminalFreeze("fr-a")).not.toBeNull();
  });

  it("消费即弃:取出后不得二次命中(重建/再挤除后旧快照不复活)", () => {
    saveTerminalFreeze(snap({ sessionId: "fz-once" }));
    expect(takeTerminalFreeze("fz-once")?.sessionId).toBe("fz-once");
    expect(takeTerminalFreeze("fz-once")).toBeNull();
  });
});

describe("会话身份指纹", () => {
  it("pid+createdAt 编码;缺省字段以占位符参与,不同进程不撞指纹", () => {
    expect(sessionFreezeFingerprint({ pid: 7, createdAt: 5 })).toBe("7:5");
    expect(sessionFreezeFingerprint({ pid: 7 })).toBe("7:-");
    expect(sessionFreezeFingerprint({})).toBe("-:-");
    expect(sessionFreezeFingerprint(null)).toBe("-:-");
    expect(sessionFreezeFingerprint({ pid: 7, createdAt: 5 })).not.toBe(
      sessionFreezeFingerprint({ pid: 8, createdAt: 5 }),
    );
  });
});

describe("快照裁决 resolveFreezeReplay", () => {
  const UNLOAD = "旧屏四字"; // 4 字符 / 12 字节(汉字 3B)
  const APPEND = "增量段"; // 3 字符 / 9 字节
  const base = snap({
    sessionId: "fz-r",
    unloadChars: UNLOAD.length,
    bytePos: bytesOf(UNLOAD),
    headSample: UNLOAD.slice(0, HEAD_SAMPLE_CHARS),
  });

  it("命中:增量 = 缓冲去掉卸载前缀(字节水位与字符切片双口径)", () => {
    const cur = UNLOAD + APPEND;
    const r = resolveFreezeReplay(cur, bytesOf(cur), base, "7:5");
    expect(r).toEqual({ mode: "fast", incremental: APPEND, snap: base });
  });

  it("命中且无新字节:增量空串(同步铺屏后零补写)", () => {
    const r = resolveFreezeReplay(UNLOAD, bytesOf(UNLOAD), base, "7:5");
    expect(r).toEqual({ mode: "fast", incremental: "", snap: base });
  });

  it("指纹不匹配(同 id 重 spawn)弃用", () => {
    const cur = UNLOAD + APPEND;
    expect(resolveFreezeReplay(cur, bytesOf(cur), base, "9:9").mode).toBe("full");
  });

  it("无存档弃用", () => {
    expect(resolveFreezeReplay(UNLOAD + APPEND, bytesOf(UNLOAD + APPEND), null, "7:5").mode).toBe("full");
  });

  it("缓冲从头截断(头样本不吻合)弃用 —— 卸载后发生挤压截尾,投影边界失锚", () => {
    const cur = "截断后的全新头部" + APPEND;
    expect(resolveFreezeReplay(cur, bytesOf(cur), base, "7:5").mode).toBe("full");
  });

  it("字符水位回退(缓冲短于卸载时刻)弃用", () => {
    expect(resolveFreezeReplay(UNLOAD.slice(0, 2), 4, base, "7:5").mode).toBe("full");
  });

  it("字节水位回退弃用:头样本(48 字符)之内完好、其后的缓冲段被更少字节的内容顶替", () => {
    // 卸载区 52 字符(48 个 ASCII + 4 个汉字,60 字节);重开缓冲同字符数但
    // 48 字符头样本之后换成了纯 ASCII(52 字节)—— 头样本与字符水位双双放行,
    // 唯 bytePos(60)可否决:卸载区已被从头动过,投影切片边界失锚。
    const unload = "A".repeat(48) + "中中中中";
    const cur = "A".repeat(48) + "aaaa";
    const s = snap({
      sessionId: "fz-bw",
      unloadChars: unload.length,
      bytePos: bytesOf(unload),
      headSample: unload.slice(0, HEAD_SAMPLE_CHARS),
    });
    expect(cur.length).toBe(unload.length);
    expect(cur.slice(0, HEAD_SAMPLE_CHARS)).toBe(unload.slice(0, HEAD_SAMPLE_CHARS));
    expect(resolveFreezeReplay(cur, bytesOf(cur), s, "7:5").mode).toBe("full");
  });
});
