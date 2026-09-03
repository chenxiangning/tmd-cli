/**
 * 历史重写输入闸契约测试(真实 xterm 无头实例,非 mock)。
 *
 * 背景:每个会话日志都含终端查询序列(实测 ~/.tmd-cli/session 日志:
 * DA `\x1b[c`、OSC 11 颜色查询、DSR `\x1b[6n` 普遍存在)。xterm 解析时
 * 自动应答并经 onData 冒出 —— 回放/翻页重写历史时这些应答若走
 * host.writeSession,会终止宽限期让历史会话点开即走呼吸灯绿→蓝,
 * 同时把陈旧应答注入活 PTY。闸的契约:
 * 重写窗口内一切回传丢弃、窗口外(实时流/击键)原样放行、arm/release 可交叠。
 *
 * ESM 下 `@xterm/xterm` 导出 interop 异常(Terminal 非构造函数),
 * CJS require 正常 —— 测试经 createRequire 取同一运行时。
 */
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import type { Terminal as XtermTerminal } from "@xterm/xterm";
import { createReplayInputGate } from "./terminalInputGate";

const { Terminal } = createRequire(import.meta.url)("@xterm/xterm") as {
  Terminal: new () => XtermTerminal;
};

/** DSR 光标位置查询:xterm 必回 CPR。 */
const DSR_QUERY = "\x1b[6n";

/** 写完一段并等解析回调(应答在回调前同步冒出)。 */
function writeAndWait(term: XtermTerminal, data: string): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  term.write(data, resolve);
  return promise;
}

describe("历史重写输入闸(terminalInputGate)", () => {
  it("重写窗口内:历史内容里的 DSR 查询应答被丢弃,不回传 onData", async () => {
    const term = new Terminal();
    const gate = createReplayInputGate();
    const forwarded: string[] = [];
    term.onData((data) => {
      if (!gate.blocked()) forwarded.push(data);
    });

    gate.arm();
    await writeAndWait(term, `历史输出${DSR_QUERY}更多内容`);
    gate.release();

    expect(forwarded).toEqual([]);
  });

  it("窗口外:实时流里的 DSR 查询应答照常放行(CLI 正在等待)", async () => {
    const term = new Terminal();
    const gate = createReplayInputGate();
    const forwarded: string[] = [];
    term.onData((data) => {
      if (!gate.blocked()) forwarded.push(data);
    });

    await writeAndWait(term, DSR_QUERY);

    expect(forwarded).toEqual(["\x1b[1;1R"]); // CPR:第 1 行第 1 列
  });

  it("arm/release 交叠:内层 release 不误放外层窗口,配对归零才放行", async () => {
    const term = new Terminal();
    const gate = createReplayInputGate();
    const forwarded: string[] = [];
    term.onData((data) => {
      if (!gate.blocked()) forwarded.push(data);
    });

    gate.arm(); // 挂载回放
    gate.arm(); // 翻页重写交叠
    gate.release(); // 一方先完成 —— 闸仍闭合
    await writeAndWait(term, DSR_QUERY);
    expect(forwarded).toEqual([]);

    gate.release(); // 双方完成 —— 放行
    await writeAndWait(term, DSR_QUERY);
    expect(forwarded).toEqual(["\x1b[1;1R"]);
  });

  it("异常兜底多调 release 钳位到 0,不会负深度导致后续闸失效", async () => {
    const term = new Terminal();
    const gate = createReplayInputGate();
    const forwarded: string[] = [];
    term.onData((data) => {
      if (!gate.blocked()) forwarded.push(data);
    });

    gate.arm();
    gate.release();
    gate.release(); // 兜底重复释放
    await writeAndWait(term, DSR_QUERY);
    expect(forwarded).toEqual(["\x1b[1;1R"]);
  });
});
