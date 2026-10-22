/**
 * ports · 扫描生命周期单测 —— 刷新互斥闸纯逻辑:busy 互斥、busy 期间请求
 * 不丢且折叠为 busy 归零后的一次补跑(kill 后重扫不被在途扫描吞掉)。
 */

import { describe, expect, it, vi } from "vitest";
import { createRefreshGate } from "./usePortsScan";

vi.mock("@kernel/ipc", () => ({ ipc: {} }));

describe("createRefreshGate(busy 闸)", () => {
  it("空闲直接执行;busy 期间请求记待办,busy 归零后补跑一次", async () => {
    const gate = createRefreshGate();
    const blocked = Promise.withResolvers<void>();
    const ran: number[] = [];
    const job = (id: number) => async () => {
      ran.push(id);
      if (id === 1) await blocked.promise;
    };

    const first = gate.run(job(1));
    /* job 同步前缀已跑:进入 busy。 */
    expect(ran).toEqual([1]);
    expect(gate.busy).toBe(true);

    /* busy 期间的请求:记待办立即返回,不并发执行。 */
    await gate.run(job(2));
    expect(ran).toEqual([1]);

    blocked.resolve();
    await first;
    /* first 的 finally 含补跑:resolve 后恰好多跑一次。 */
    expect(ran).toEqual([1, 2]);
    expect(gate.busy).toBe(false);
  });

  it("busy 期间的多个请求折叠为一次补跑", async () => {
    const gate = createRefreshGate();
    const blocked = Promise.withResolvers<void>();
    const ran: number[] = [];
    const job = () => async () => {
      ran.push(1);
      await blocked.promise;
    };

    const first = gate.run(job());
    void gate.run(job());
    void gate.run(job());
    blocked.resolve();
    await first;
    expect(ran).toEqual([1, 1]);
    expect(gate.busy).toBe(false);
  });

  it("job 抛错不卡闸:闸归零且待办仍补跑", async () => {
    const gate = createRefreshGate();
    const blocked = Promise.withResolvers<void>();
    let second = 0;
    const failing = async () => {
      await blocked.promise;
      throw new Error("boom");
    };

    const first = gate.run(failing);
    void gate.run(async () => {
      second += 1;
    });
    blocked.resolve();
    await expect(first).rejects.toThrow("boom");
    expect(second).toBe(1);
    expect(gate.busy).toBe(false);
  });
});
