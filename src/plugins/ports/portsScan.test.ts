/**
 * ports · 扫描编排单测 —— mock ipc.procCommunicate,锁定 timedOut 聚合契约:
 * 任一步骤命令超时截断(部分输出仍解析)→ ScanOutcome.timedOut;正常轮恒 false。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ipc } from "@kernel/ipc";
import { scanPorts } from "./portsScan";

vi.mock("@kernel/ipc", () => ({ ipc: { procCommunicate: vi.fn() } }));

const comm = vi.mocked(ipc.procCommunicate);

/** 本机真实 lsof/ps 形态节选(最小行)。 */
const LSOF_OUT = "proc 100 user 4u IPv4 0x0 0t0 TCP 127.0.0.1:3000 (LISTEN)\n";
const PS_OUT = "  100     1 node server.js\n";

function mockScan(opts: { listenersTimedOut?: boolean; procsTimedOut?: boolean } = {}) {
  comm.mockImplementation(async (spec) => {
    const isListeners = spec.command === "lsof" && spec.args.includes("-iTCP");
    const isProcs = spec.command === "ps";
    return {
      stdout: isListeners ? LSOF_OUT : isProcs ? PS_OUT : "",
      stderr: "",
      code: 0,
      timedOut: (isListeners && (opts.listenersTimedOut ?? false)) || (isProcs && (opts.procsTimedOut ?? false)),
    };
  });
}

describe("scanPorts(timedOut 聚合)", () => {
  beforeEach(() => {
    comm.mockReset();
  });

  it("全部步骤正常 → timedOut false,行与进程 enrich 不受影响", async () => {
    mockScan();
    const out = await scanPorts("mac");
    expect(out.timedOut).toBe(false);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toMatchObject({ port: 3000, pid: 100, process: "node" });
  });

  it("端口工具超时截断:部分输出仍解析,timedOut 置位", async () => {
    mockScan({ listenersTimedOut: true });
    const out = await scanPorts("mac");
    expect(out.timedOut).toBe(true);
    expect(out.rows.map((r) => r.port)).toEqual([3000]);
  });

  it("进程图谱步骤超时同样置位", async () => {
    mockScan({ procsTimedOut: true });
    expect((await scanPorts("mac")).timedOut).toBe(true);
  });
});
