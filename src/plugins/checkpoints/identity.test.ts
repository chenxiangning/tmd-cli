/**
 * checkpoints 账本主键仲裁测试(resolveLedgerKey)。
 * 核心场景:cli 磁盘身份被多个活会话争持(内核绑定竞态)时,
 * 先创建者保留 cli 身份,后到者回退 tmd id —— 新会话不得看到老会话的账。
 */
import { describe, expect, it } from "vitest";
import { resolveLedgerKey } from "./identity";

const peers = (list: Array<{ id: string; createdAt?: number }>) => list;
const cliOf =
  (map: Record<string, string>) =>
  (id: string): string | undefined =>
    map[id];

describe("resolveLedgerKey 账本主键仲裁", () => {
  it("无绑定:tmd id 记账(首条 prompt 常见)", () => {
    expect(resolveLedgerKey({ id: "t1" }, undefined, [], cliOf({}))).toBe("t1");
  });

  it("cli 身份无争持:用 cli id(重启/resume 可找回历史)", () => {
    expect(
      resolveLedgerKey({ id: "t1", createdAt: 100 }, "cli-1", peers([{ id: "t2", createdAt: 50 }]), cliOf({ t2: "cli-2" })),
    ).toBe("cli-1");
  });

  it("争持且我更早创建:我保留 cli id(合法持有者不受损)", () => {
    expect(
      resolveLedgerKey({ id: "t-old", createdAt: 100 }, "cli-1", peers([{ id: "t-new", createdAt: 200 }]), cliOf({ "t-new": "cli-1" })),
    ).toBe("cli-1");
  });

  it("争持且我是后到者(绑定被新会话盗走):回退 tmd id,不并进老账", () => {
    expect(
      resolveLedgerKey({ id: "t-new", createdAt: 200 }, "cli-1", peers([{ id: "t-old", createdAt: 100 }]), cliOf({ "t-old": "cli-1" })),
    ).toBe("t-new");
  });

  it("缺 createdAt 按最新处理:时间戳明确的老会话赢", () => {
    expect(
      resolveLedgerKey({ id: "t-x" }, "cli-1", peers([{ id: "t-old", createdAt: 1 }]), cliOf({ "t-old": "cli-1" })),
    ).toBe("t-x");
  });

  it("同毫秒创建:id 字典序定全序(两边判定互斥,不会都赢)", () => {
    const map = cliOf({ a: "cli-1", b: "cli-1" });
    expect(resolveLedgerKey({ id: "a", createdAt: 1 }, "cli-1", peers([{ id: "b", createdAt: 1 }]), map)).toBe("cli-1");
    expect(resolveLedgerKey({ id: "b", createdAt: 1 }, "cli-1", peers([{ id: "a", createdAt: 1 }]), map)).toBe("b");
  });

  it("三方争持:最早的独享,其余各自回退", () => {
    const map = cliOf({ t1: "cli-1", t2: "cli-1", t3: "cli-1" });
    const all = peers([
      { id: "t1", createdAt: 100 },
      { id: "t2", createdAt: 200 },
      { id: "t3", createdAt: 300 },
    ]);
    expect(resolveLedgerKey({ id: "t1", createdAt: 100 }, "cli-1", all, map)).toBe("cli-1");
    expect(resolveLedgerKey({ id: "t2", createdAt: 200 }, "cli-1", all, map)).toBe("t2");
    expect(resolveLedgerKey({ id: "t3", createdAt: 300 }, "cli-1", all, map)).toBe("t3");
  });
});
