/**
 * settleTerminalFreeze 水位扣减契约(2026-10-26 复审 P1 冲刷×快照隔 xterm
 * 异步解析):flushed = 卸载前冲入幕布但下一宏任务才解析的字符数,快照投影
 * 不含它们 → unloadChars/bytePos 必须各减 flushed,水位让渡给重开 fast
 * 路径的增量补写收尾,否则 [投影末端, unloadChars) 段永久缺失。
 */
import { describe, expect, it, vi } from "vitest";
import type { Terminal } from "@xterm/xterm";

vi.mock("@kernel/host", () => ({
  host: {
    reseedScreenMirror: vi.fn(),
    getOutputBuffer: vi.fn(() => "0123456789"),
    getOutputBufferBytes: vi.fn(() => 10),
    getSessions: vi.fn(() => []),
  },
}));

vi.mock("@kernel/terminalFreeze", () => ({
  HEAD_SAMPLE_CHARS: 48,
  saveTerminalFreeze: vi.fn(),
  sessionFreezeFingerprint: vi.fn(() => "f"),
}));

vi.mock("@kernel/rafFallback", () => ({ nativeRafGapMs: vi.fn() }));
vi.mock("@kernel/canvasStall", () => ({ shouldRebuildCanvas: vi.fn(), STALL_CANVAS_SILENCE_MS: 1 }));

import { settleTerminalFreeze } from "./terminalCanvasHealth";
import { saveTerminalFreeze } from "./terminalFreeze";
const snapOf = () => vi.mocked(saveTerminalFreeze).mock.calls.at(-1)![0];
/** 2 行 × 4 列的最小幕布:投影两行,光标 (1,1)。 */
function fakeTerm(): Terminal {
  return {
    cols: 4,
    rows: 2,
    buffer: {
      active: {
        baseY: 0,
        length: 2,
        cursorX: 1,
        cursorY: 1,
        getLine: (r: number) => ({ translateToString: () => `L${r}` }),
      },
    },
  } as unknown as Terminal;
}


describe("settleTerminalFreeze flushed 扣减", () => {
  it("缺省 flushed=0:水位 = 缓冲全长(既有语义)", () => {
    vi.mocked(saveTerminalFreeze).mockClear();
    settleTerminalFreeze("s", fakeTerm());
    expect(snapOf().unloadChars).toBe(10);
    expect(snapOf().bytePos).toBe(10);
  });

  it("flushed>0:unloadChars/bytePos 各减 flushed,钳位不落负", () => {
    vi.mocked(saveTerminalFreeze).mockClear();
    settleTerminalFreeze("s", fakeTerm(), 4);
    expect(snapOf().unloadChars).toBe(6);
    expect(snapOf().bytePos).toBe(6);
    settleTerminalFreeze("s", fakeTerm(), 99);
    expect(snapOf().unloadChars).toBe(0);
    expect(snapOf().bytePos).toBe(0);
  });
});
