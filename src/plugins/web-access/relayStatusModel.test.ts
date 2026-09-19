/**
 * web-access 纯模型两件套(同目录小兄弟,并入一文件):
 * relayStatusModel —— relayStatusText 四态:null 未连接 / connected 已连接 /
 *   error 原文透传(优先于连接中)/ 无 error 未连接显示连接中;
 *   relayStatusDot 三态圆点:未连接白点、已连接绿点、其余黄点。
 * wanRiskAccepted —— localStorage 读写面:未写 false、仅 "1" 为 true、
 *   其他值("0"/"true")均 false;write 落 "1";localStorage 不可用(抛异常)
 *   时读回落 false(每次询问)、写静默不抛(语义更严,放行)。
 * 手法:localStorage 用内存 stub(vi.stubGlobal,node 无 DOM);i18n 未引导
 * 词典时 t() 回落源中文串,断言直接用源串。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RelayInfo } from "@kernel/ipc";
import { relayStatusDot, relayStatusText } from "./relayStatusModel";
import { readWanRiskAccepted, writeWanRiskAccepted } from "./wanRiskAccepted";

const info = (extra: Partial<RelayInfo> = {}): RelayInfo => ({
  url: "http://127.0.0.1:1",
  agentUrl: "http://127.0.0.1:2",
  connected: false,
  error: null,
  ...extra,
});

describe("relayStatusModel", () => {
  it("relayStatusText:null 未连接;connected 已连接;error 原文透传", () => {
    expect(relayStatusText(null)).toBe("未连接");
    expect(relayStatusText(info({ connected: true, error: "任意" }))).toBe("已连接");
    expect(relayStatusText(info({ error: "TLS 握手失败" }))).toBe("TLS 握手失败");
  });

  it("relayStatusText:未连接且无 error 显示连接中", () => {
    expect(relayStatusText(info())).toBe("连接中…");
  });

  it("relayStatusDot:未连接白点、已连接绿点、连接中与出错黄点", () => {
    expect(relayStatusDot(null)).toBe("⚪");
    expect(relayStatusDot(info({ connected: true }))).toBe("🟢");
    expect(relayStatusDot(info())).toBe("🟡");
    expect(relayStatusDot(info({ error: "x" }))).toBe("🟡");
  });
});

describe("wanRiskAccepted", () => {
  let backing: Map<string, string>;

  const stubStorage = (opts: { getItemThrows?: boolean; setItemThrows?: boolean } = {}) => {
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => {
        if (opts.getItemThrows) throw new Error("storage denied");
        return backing.get(k) ?? null;
      },
      setItem: (k: string, v: string) => {
        if (opts.setItemThrows) throw new Error("storage denied");
        backing.set(k, v);
      },
    });
  };

  beforeEach(() => {
    backing = new Map();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("仅值为 \"1\" 视为已确认;未写入或其他值均为 false", () => {
    stubStorage();
    expect(readWanRiskAccepted()).toBe(false);
    backing.set("tmd.webWanRiskAccepted", "1");
    expect(readWanRiskAccepted()).toBe(true);
    backing.set("tmd.webWanRiskAccepted", "0");
    expect(readWanRiskAccepted()).toBe(false);
    backing.set("tmd.webWanRiskAccepted", "true");
    expect(readWanRiskAccepted()).toBe(false);
  });

  it("writeWanRiskAccepted 落 \"1\",写后读回 true", () => {
    stubStorage();
    writeWanRiskAccepted();
    expect(backing.get("tmd.webWanRiskAccepted")).toBe("1");
    expect(readWanRiskAccepted()).toBe(true);
  });

  it("localStorage 不可用:读回落 false(每次询问),写静默不抛", () => {
    stubStorage({ getItemThrows: true, setItemThrows: true });
    expect(readWanRiskAccepted()).toBe(false);
    expect(() => writeWanRiskAccepted()).not.toThrow();
  });
});
