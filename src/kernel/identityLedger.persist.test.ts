/**
 * 身份账本跨重载持久化契约(2026-09-17 实证回归)。
 * PTY 经 readopt 跨 webview 重载存活,绑定必须跟随 —— 否则活行丢 cliSessionId:
 * 重命名退短码(手动命名/磁盘原生标题/首条消息兜底全失联)、活/盘不去重、
 * 状态 pill 失明。死项只认活会话表:prune 在 readopt 定稿后剪 —— 冷启动
 * Rust 注册表为空,一次清空陈账(陈账占用的磁盘身份会 fail-closed 挡住
 * resume 同身份的新会话);重载则活表全保留。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { IdentityLedger } from "./identityLedger";
import type { SessionMeta } from "./ipc";

const store = new Map<string, string>();
/* node 测试环境无 localStorage:注入结构化最小子集替代(测试自管存储,无可校验真源) */
const storageStub = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
} as unknown as Storage;
const alive = new Set<string>();
const findSession = (id: string) =>
  alive.has(id) ? ({ id, profileId: "omp", cwd: "/w" } as SessionMeta) : undefined;

beforeEach(() => {
  store.clear();
  alive.clear();
  globalThis.localStorage = storageStub;
});

describe("IdentityLedger 跨重载持久化", () => {
  it("绑定跨实例(模拟 webview 重载)存活:新账本回装同一绑定", () => {
    alive.add("s1");
    const boot1 = new IdentityLedger(findSession);
    expect(boot1.bind("s1", "cli-a")).toBe(true);
    const boot2 = new IdentityLedger(findSession); // 重载 = 全新模块态 + 回装
    expect(boot2.get("s1")).toBe("cli-a");
    expect(boot2.claimedIds().has("cli-a")).toBe(true);
  });

  it("冷启动空活表:prune 清陈账,不再 fail-closed 挡新会话绑同一身份", () => {
    alive.add("s1");
    const boot1 = new IdentityLedger(findSession);
    boot1.bind("s1", "cli-a");
    alive.clear(); // 应用重启:PTY 全灭,Rust 注册表空
    const boot2 = new IdentityLedger(findSession);
    expect(boot2.get("s1")).toBe("cli-a"); // 陈账尚在
    boot2.prune();
    expect(boot2.get("s1")).toBeUndefined();
    const boot3 = new IdentityLedger(findSession); // 剪除结果已落盘
    expect(boot3.get("s1")).toBeUndefined();
    expect(boot3.claimedIds().has("cli-a")).toBe(false);
  });

  it("重载场景 prune 保留活表全量绑定;会话退出即删并落盘", () => {
    alive.add("s1");
    const boot1 = new IdentityLedger(findSession);
    boot1.bind("s1", "cli-a");
    const boot2 = new IdentityLedger(findSession); // 重载,readopt 恢复活表
    boot2.prune();
    expect(boot2.get("s1")).toBe("cli-a");
    boot2.remove("s1"); // 会话退出
    const boot3 = new IdentityLedger(findSession);
    expect(boot3.get("s1")).toBeUndefined();
  });

  it("抢绑终审不受持久化影响:rival 绑定失败不落盘", () => {
    alive.add("s1");
    alive.add("s2");
    const ledger = new IdentityLedger(findSession);
    expect(ledger.bind("s1", "cli-a")).toBe(true);
    expect(ledger.bind("s2", "cli-a")).toBe(false);
    expect(ledger.get("s2")).toBeUndefined();
    expect(new IdentityLedger(findSession).claimedIds()).toEqual(new Set(["cli-a"]));
  });
});
