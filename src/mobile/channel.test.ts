/**
 * 双通道端点选择契约(currentEndpoint = 竞速候选序首项):
 * - 旧凭证(无 urls):回落 [wsUrl]
 * - 钉 auto:urls 序(LAN 在配对时已排前)
 * - 钉某端点:该端点优先;钉失效端点(不在 urls)回 auto
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@kernel/transport", () => ({
  configureRemoteEndpoint: vi.fn(),
  onRemoteRevoked: vi.fn(() => vi.fn()),
  serverVersion: vi.fn(() => Promise.resolve(null)),
  serverCapabilities: vi.fn(() => Promise.resolve([])),
}));

import { currentEndpoint } from "./shared";
import { saveChannelPin, type MobileCreds } from "./creds";

const LAN = "ws://192.168.1.4:53050";
const RELAY = "wss://relay.example";
const creds = (over: Partial<MobileCreds> = {}): MobileCreds => ({
  wsUrl: LAN,
  deviceId: "d",
  token: "t",
  hostName: "h",
  urls: [LAN, RELAY],
  ...over,
});

beforeEach(() => {
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  });
});

describe("双通道端点选择", () => {
  it("auto = urls 序首项(LAN 优先)", () => {
    expect(currentEndpoint(creds())).toBe(LAN);
  });

  it("钉 relay → relay 优先", () => {
    saveChannelPin(RELAY);
    expect(currentEndpoint(creds())).toBe(RELAY);
  });

  it("钉失效端点(不在 urls)→ 回 auto 序", () => {
    saveChannelPin("ws://gone");
    expect(currentEndpoint(creds())).toBe(LAN);
  });

  it("旧凭证无 urls → 单 wsUrl 候选", () => {
    saveChannelPin(RELAY); // 钉了也不在候选里
    expect(currentEndpoint(creds({ urls: undefined }))).toBe(LAN);
  });
});
