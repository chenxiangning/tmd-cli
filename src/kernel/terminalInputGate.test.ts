/**
 * 历史重写输入闸契约测试。
 *
 * 两层验证:
 * - 纯策略(闸态 → 放行判定,与 TerminalView.onData 同款判定内联):
 *   闸窗(启动窗 = 回放/翻页窗,同一计数)内只放行整段终端协议回传,
 *   用户形态输入与拆碎应答片段(pi-tui StdinBuffer 50ms 拆段,2026-09-10
 *   实证)照弃;窗口外一切照常;计数可交叠、多释放钳位到 0。
 * - 真实 xterm 无头实例:DSR `\x1b[6n` 解析时自动应答 CPR 经 onData 冒出,
 *   验证闸窗内放行的端到端行为。这是两条白屏实证的回归锚:ssh exec wsl.exe
 *   启动链发 CPR 后死等应答,应答被吞 = 幕布永久白屏(2026-09-11 首证;
 *   2026-09-12 二证:连接先于幕布挂载完成时 CPR 落缓冲走回放分支,回放窗
 *   也必须放行)。
 *
 * 注:xterm 的 onData 只由输入事件与查询自动应答触发,write 普通字符不冒
 * onData,故用户输入路径只能走纯策略断言。
 * ESM 下 `@xterm/xterm` 导出 interop 异常(Terminal 非构造函数),
 * CJS require 正常 —— 测试经 createRequire 取同一运行时。
 */
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import type { Terminal as XtermTerminal } from "@xterm/xterm";
import { createReplayInputGate, type ReplayInputGate } from "./terminalInputGate";
import { isTerminalReport } from "./terminalReports";

const { Terminal } = createRequire(import.meta.url)("@xterm/xterm") as {
  Terminal: new () => XtermTerminal;
};

/** DSR 光标位置查询:xterm 必回 CPR。 */
const DSR_QUERY = "\x1b[6n";
const CPR_REPLY = "\x1b[1;1R"; // CPR:第 1 行第 1 列

/** TerminalView.onData 同款闸策略(窗内只放行整段协议回传)。 */
function gateAllows(gate: ReplayInputGate, data: string): boolean {
  return !gate.blocked() || isTerminalReport(data);
}

/** 写完一段并等解析回调(应答在回调前同步冒出)。 */
function writeAndWait(term: XtermTerminal, data: string): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  term.write(data, resolve);
  return promise;
}

describe("输入闸纯策略(启动窗 = 回放窗,同一策略)", () => {
  it("闸窗内:整段协议回传放行,击键与拆碎片段丢弃", () => {
    const gate = createReplayInputGate();
    gate.arm();
    expect(gate.blocked()).toBe(true);
    expect(gateAllows(gate, CPR_REPLY)).toBe(true); // 挂载竞态下回放窗里的活 CPR
    expect(gateAllows(gate, "\x1b[?1u")).toBe(true); // kitty 标志应答
    expect(gateAllows(gate, "ls\r")).toBe(false); // 用户击键
    expect(gateAllows(gate, "\x1b[1;")).toBe(false); // 拆段前缀
    expect(gateAllows(gate, "1R")).toBe(false); // 拆段终结字节
    gate.release();
  });

  it("窗口外:一切照常放行", () => {
    const gate = createReplayInputGate();
    expect(gateAllows(gate, "ls\r")).toBe(true);
    expect(gateAllows(gate, CPR_REPLY)).toBe(true);
  });

  it("计数交叠与钳位:多 release 不产生负深度,配对归零才恢复", () => {
    const gate = createReplayInputGate();
    gate.arm();
    gate.arm();
    gate.release();
    expect(gateAllows(gate, "a")).toBe(false);
    gate.release();
    gate.release(); // 兜底重复释放
    expect(gate.blocked()).toBe(false);
    expect(gateAllows(gate, "a")).toBe(true);
  });
});

describe("历史重写输入闸 × 真实 xterm(查询自动应答端到端)", () => {
  it("闸窗(回放)内:DSR 查询的 CPR 应答经 onData 放行(挂载竞态回归锚)", async () => {
    const term = new Terminal();
    const gate = createReplayInputGate();
    const forwarded: string[] = [];
    term.onData((data) => {
      if (gateAllows(gate, data)) forwarded.push(data);
    });

    gate.arm();
    await writeAndWait(term, `回放缓冲${DSR_QUERY}`);
    gate.release();

    // 光标停在第 9 列(前缀 4 个全角字符),CPR 应答行列随之
    expect(forwarded).toEqual(["\x1b[1;9R"]);
  });

  it("窗口外:实时流里的 DSR 查询应答照常放行(CLI 正在等待)", async () => {
    const term = new Terminal();
    const gate = createReplayInputGate();
    const forwarded: string[] = [];
    term.onData((data) => {
      if (gateAllows(gate, data)) forwarded.push(data);
    });

    await writeAndWait(term, DSR_QUERY);

    expect(forwarded).toEqual([CPR_REPLY]);
  });
});
