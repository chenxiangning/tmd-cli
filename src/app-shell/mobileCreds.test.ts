/**
 * mobileCreds 迁移矩阵测试(壳桥 mock):
 * 仅旧值 / 仅钥匙串 / 双有以钥匙串为准 / 全无 = null / 钥匙串抛错回落旧值 /
 * 非壳态 localStorage 原语义 / 壳态写钥匙串成功后清 localStorage、失败回落 /
 * 钥匙串命中后 loadCreds 走缓存。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { value?: string | null; error?: string };

const bridge = vi.hoisted(() => ({
  has: false,
  getFn: (): Result => ({ value: null }),
  setCalls: [] as string[],
  setFail: false,
  delCalls: 0,
}));

vi.mock("@kernel/shellBridge", () => ({
  hasShellBridge: () => bridge.has,
  shellCreds: {
    get: () => {
      const r = bridge.getFn();
      return r.error ? Promise.reject(new Error(r.error)) : Promise.resolve(r.value ?? null);
    },
    set: (j: string) => {
      bridge.setCalls.push(j);
      return bridge.setFail ? Promise.reject(new Error("locked")) : Promise.resolve();
    },
    delete: () => {
      bridge.delCalls += 1;
      return Promise.resolve();
    },
  },
}));

let creds: typeof import("./mobileCreds");
const CREDS = { wsUrl: "ws://h:1", deviceId: "d", token: "t", hostName: "h" };

function fakeLocalStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  });
  return {
    get: (k: string) => map.get(k),
    has: (k: string) => map.has(k),
  };
}

beforeEach(async () => {
  vi.resetModules();
  bridge.has = false;
  bridge.getFn = () => ({ value: null });
  bridge.setCalls = [];
  bridge.setFail = false;
  bridge.delCalls = 0;
  creds = await import("./mobileCreds");
});

describe("mobileCreds 迁移矩阵", () => {
  it("非壳态:resolve = localStorage 原语义,不触桥", async () => {
    const ls = fakeLocalStorage({ [creds.CREDS_KEY]: JSON.stringify(CREDS) });
    expect(await creds.resolveCreds()).toEqual(CREDS);
    expect(bridge.setCalls.length).toBe(0);
    expect(ls.get(creds.CREDS_KEY)).toBeTruthy();
  });

  it("壳态仅钥匙串命中:直接返回 + loadCreds 走缓存(localStorage 已被迁移清空)", async () => {
    bridge.has = true;
    fakeLocalStorage({});
    bridge.getFn = () => ({ value: JSON.stringify(CREDS) });
    expect(await creds.resolveCreds()).toEqual(CREDS);
    expect(bridge.setCalls.length).toBe(0);
    // 钥匙串命中后同步 loadCreds 走缓存(RemoteHostBar 消费;localStorage 无值)
    expect(creds.loadCreds()).toEqual(CREDS);
  });

  it("壳态仅旧值:迁移写钥匙串并清 localStorage", async () => {
    bridge.has = true;
    const ls = fakeLocalStorage({ [creds.CREDS_KEY]: JSON.stringify(CREDS) });
    expect(await creds.resolveCreds()).toEqual(CREDS);
    expect(bridge.setCalls).toEqual([JSON.stringify(CREDS)]);
    expect(ls.has(creds.CREDS_KEY)).toBe(false);
  });

  it("壳态双有:以钥匙串为准(旧值残留不返回)", async () => {
    bridge.has = true;
    const other = { ...CREDS, deviceId: "keychain" };
    fakeLocalStorage({ [creds.CREDS_KEY]: JSON.stringify({ ...CREDS, deviceId: "stale" }) });
    bridge.getFn = () => ({ value: JSON.stringify(other) });
    const got = await creds.resolveCreds();
    expect(got?.deviceId).toBe("keychain");
    expect(bridge.setCalls.length).toBe(0);
  });

  it("壳态全无:null(配对屏)", async () => {
    bridge.has = true;
    fakeLocalStorage({});
    expect(await creds.resolveCreds()).toBeNull();
  });

  it("钥匙串读抛错 + 写也失败:回落旧值,localStorage 保留(下次再迁)", async () => {
    bridge.has = true;
    bridge.getFn = () => ({ error: "locked" });
    bridge.setFail = true;
    const ls = fakeLocalStorage({ [creds.CREDS_KEY]: JSON.stringify(CREDS) });
    expect(await creds.resolveCreds()).toEqual(CREDS);
    expect(ls.has(creds.CREDS_KEY)).toBe(true);
  });

  it("壳态写入成功清 localStorage;写失败回落写入", async () => {
    bridge.has = true;
    const ls = fakeLocalStorage({});
    await creds.persistCreds(CREDS);
    expect(bridge.setCalls.length).toBe(1);
    expect(ls.has(creds.CREDS_KEY)).toBe(false);

    bridge.setFail = true;
    await creds.persistCreds(CREDS);
    expect(ls.get(creds.CREDS_KEY)).toBeTruthy();
  });

  it("撤销清空:壳态删钥匙串 + 清 localStorage + 缓存归 null", async () => {
    bridge.has = true;
    const ls = fakeLocalStorage({ [creds.CREDS_KEY]: JSON.stringify(CREDS) });
    await creds.persistCreds(null);
    expect(bridge.delCalls).toBe(1);
    expect(ls.has(creds.CREDS_KEY)).toBe(false);
    expect(creds.loadCreds()).toBeNull();
  });
});
