/**
 * DSH host 连接面板纯函数契约:连接归一/持久化 + host.describe 线格式
 * (codemoss host.rs 同款:client-request → server-response 信封)。
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CONNECTION,
  describeRequestBody,
  loadConnection,
  normalizeConnection,
  originOf,
  parseDescribeResponse,
  saveConnection,
  DSH_CONNECTION_KEY,
} from "./dshHost";

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
  it("空 host / 非法端口回默认 127.0.0.1:3080", () => {
    expect(normalizeConnection("", "abc")).toEqual({ host: "127.0.0.1", port: 3080 });
  });

  it("端口截到 1-65535", () => {
    expect(normalizeConnection(" 0.0.0.0 ", "0").port).toBe(1);
    expect(normalizeConnection("0.0.0.0", "99999").port).toBe(65535);
    expect(normalizeConnection("0.0.0.0", "8080")).toEqual({ host: "0.0.0.0", port: 8080 });
  });
});

describe("loadConnection / saveConnection", () => {
  it("无存档回默认;坏 JSON 不抛", () => {
    expect(loadConnection()).toEqual(DEFAULT_CONNECTION);
    localStorage.setItem(DSH_CONNECTION_KEY, "{broken");
    expect(loadConnection()).toEqual(DEFAULT_CONNECTION);
  });

  it("存档round-trip;坏字段逐项回默认", () => {
    saveConnection({ host: "0.0.0.0", port: 4000 });
    expect(loadConnection()).toEqual({ host: "0.0.0.0", port: 4000 });
    localStorage.setItem(DSH_CONNECTION_KEY, JSON.stringify({ host: "", port: -3 }));
    expect(loadConnection()).toEqual(DEFAULT_CONNECTION);
  });
});

describe("host.describe 线格式", () => {
  it("请求体:client-request + host.describe + 空 payload", () => {
    expect(describeRequestBody("rpc-1")).toBe(
      JSON.stringify({ type: "client-request", rpcId: "rpc-1", method: "host.describe", payload: {} }),
    );
  });

  it("origin 拼接", () => {
    expect(originOf({ host: "127.0.0.1", port: 3080 })).toBe("http://127.0.0.1:3080");
  });
});

describe("parseDescribeResponse", () => {
  it("server-response ok → 只透传已知字段", () => {
    const body = {
      type: "server-response",
      rpcId: "tmd-1",
      result: { ok: true, value: { provider: "minimax-cn", model: "MiniMax-M3", sessions: 17 } },
    };
    expect(parseDescribeResponse(200, body)).toEqual({
      provider: "minimax-cn",
      model: "MiniMax-M3",
      sessions: 17,
    });
  });

  it("缺字段返回部分视图;value 非对象返回空视图", () => {
    expect(parseDescribeResponse(200, {
      type: "server-response",
      result: { ok: true, value: { provider: "deepseek" } },
    })).toEqual({ provider: "deepseek" });
    expect(parseDescribeResponse(200, {
      type: "server-response",
      result: { ok: true, value: "plain" },
    })).toEqual({});
  });

  it("ok:false / 信封错型 / 非 200 / 抛错输入 → null", () => {
    expect(parseDescribeResponse(200, {
      type: "server-response",
      result: { ok: false, error: { code: "x", message: "boom" } },
    })).toBeNull();
    expect(parseDescribeResponse(200, { type: "other" })).toBeNull();
    expect(parseDescribeResponse(502, { type: "server-response", result: { ok: true, value: {} } })).toBeNull();
    expect(parseDescribeResponse(200, null)).toBeNull();
  });
});
