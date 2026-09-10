/**
 * DSH 连接配置域契约:连接归一(origin 变更弃凭据)/持久化(旧档补默认)+
 * BrowserAuth 凭据头回读 + Web UI 入口 URL。
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CONNECTION,
  authHeaders,
  dshCommand,
  isLocalHost,
  loadConnection,
  normalizeConnection,
  originOf,
  saveConnection,
  webUiUrl,
  DSH_CONNECTION_KEY,
} from "./dshConnection";

/* node 环境无 DOM:桩最小 localStorage,DSH_CONNECTION_KEY 也由它承载。 */
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
});
afterEach(() => {
  store.clear();
});

describe("normalizeConnection", () => {
  it("空 host / 非法端口回默认 127.0.0.1:3080,其余字段沿用 base", () => {
    expect(normalizeConnection("", "abc")).toEqual(DEFAULT_CONNECTION);
    expect(
      normalizeConnection("", "abc", {
        host: "0.0.0.0",
        port: 4000,
        customBin: "/opt/dsh",
        autoStart: false,
      }),
    ).toEqual({ host: "127.0.0.1", port: 3080, customBin: "/opt/dsh", autoStart: false });
  });

  it("端口截到 1-65535", () => {
    expect(normalizeConnection(" 0.0.0.0 ", "0").port).toBe(1);
    expect(normalizeConnection("0.0.0.0", "99999").port).toBe(65535);
    expect(normalizeConnection("0.0.0.0", "8080")).toEqual({
      host: "0.0.0.0",
      port: 8080,
      customBin: "",
      autoStart: true,
    });
  });

  it("origin 变更弃凭据(cookie 按 host:port authority 绑定),原 origin 保留", () => {
    const cred = { cookie: "dsh-auth-x=v1.a", launchToken: "ts_1" };
    expect(normalizeConnection("0.0.0.0", "4000", { ...DEFAULT_CONNECTION, ...cred })).toEqual({
      host: "0.0.0.0",
      port: 4000,
      customBin: "",
      autoStart: true,
    });
    expect(normalizeConnection("127.0.0.1", "3080", { ...DEFAULT_CONNECTION, ...cred }).cookie).toBe("dsh-auth-x=v1.a");
  });
});

describe("loadConnection / saveConnection", () => {
  it("无存档回默认;坏 JSON 不抛", () => {
    expect(loadConnection()).toEqual(DEFAULT_CONNECTION);
    localStorage.setItem(DSH_CONNECTION_KEY, "{broken");
    expect(loadConnection()).toEqual(DEFAULT_CONNECTION);
  });

  it("存档 round-trip;旧档缺字段逐项补默认", () => {
    saveConnection({ host: "0.0.0.0", port: 4000, customBin: "/opt/dsh", autoStart: false });
    expect(loadConnection()).toEqual({
      host: "0.0.0.0",
      port: 4000,
      customBin: "/opt/dsh",
      autoStart: false,
    });
    localStorage.setItem(DSH_CONNECTION_KEY, JSON.stringify({ host: "", port: -3 }));
    expect(loadConnection()).toEqual(DEFAULT_CONNECTION);
    localStorage.setItem(DSH_CONNECTION_KEY, JSON.stringify({ host: "0.0.0.0", port: 4000 }));
    expect(loadConnection()).toEqual({ ...DEFAULT_CONNECTION, host: "0.0.0.0", port: 4000 });
  });

  it("凭据字段 round-trip(cookie/launchToken)", () => {
    saveConnection({ ...DEFAULT_CONNECTION, cookie: "dsh-auth-x=v1.a", launchToken: "ts_1" });
    expect(loadConnection()).toEqual({ ...DEFAULT_CONNECTION, cookie: "dsh-auth-x=v1.a", launchToken: "ts_1" });
  });
});

describe("启动命令与鉴权头", () => {
  it("dshCommand:自定义路径优先,空串回退 PATH 的 dsh", () => {
    expect(dshCommand({ ...DEFAULT_CONNECTION, customBin: " /opt/dsh " })).toBe("/opt/dsh");
    expect(dshCommand(DEFAULT_CONNECTION)).toBe("dsh");
  });

  it("authHeaders:conn 快照缺 cookie 回读落盘;两者皆无回空", () => {
    expect(authHeaders({ ...DEFAULT_CONNECTION })).toEqual({});
    saveConnection({ ...DEFAULT_CONNECTION, cookie: "dsh-auth-x=v1.a" });
    expect(authHeaders({ ...DEFAULT_CONNECTION })).toEqual({ cookie: "dsh-auth-x=v1.a" });
    expect(authHeaders({ ...DEFAULT_CONNECTION, cookie: "dsh-auth-y=v1.b" })).toEqual({
      cookie: "dsh-auth-y=v1.b",
    });
  });

  it("webUiUrl:有 launch token 带 token 过门禁,无则裸 origin", () => {
    expect(webUiUrl({ ...DEFAULT_CONNECTION, launchToken: "ts_abc" })).toBe(
      "http://127.0.0.1:3080/?token=ts_abc",
    );
    expect(webUiUrl(DEFAULT_CONNECTION)).toBe("http://127.0.0.1:3080");
  });

  it("origin 拼接", () => {
    expect(originOf({ host: "127.0.0.1", port: 3080, customBin: "", autoStart: true })).toBe(
      "http://127.0.0.1:3080",
    );
  });
});

describe("isLocalHost(停机准入口径)", () => {
  it("本机回环地址放行,远程地址拒绝", () => {
    expect(isLocalHost("127.0.0.1")).toBe(true);
    expect(isLocalHost("localhost")).toBe(true);
    expect(isLocalHost("::1")).toBe(true);
    expect(isLocalHost("0.0.0.0")).toBe(true);
    expect(isLocalHost("10.0.0.5")).toBe(false);
  });
});
