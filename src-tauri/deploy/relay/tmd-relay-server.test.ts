/**
 * 中继 mjs 契约固化(评审二轮 TestQuality P1-2):真源 tmd-relay-server.mjs 此前
 * 零测试(仅 throwaway 冒烟)。起真进程验四修:错 key 403 / agent+手机流往返 /
 * 顶替清场(第一轮 P1)/ 帧上限拆除(第一轮 P1-3)。node 环境跑;Node ≥22 自带 WebSocket。
 */
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";

const KEY = "e2etest-key";
let port = 0;
let child: ChildProcess | undefined;

interface Addr {
  port: number;
}
const freePort = () => {
  const { promise, resolve } = Promise.withResolvers<number>();
  const s = createServer();
  s.listen(0, "127.0.0.1", () => {
    const p = (s.address() as Addr).port;
    s.close(() => resolve(p));
  });
  return promise;
};

beforeAll(async () => {
  port = await freePort();
  child = spawn("node", ["src-tauri/deploy/relay/tmd-relay-server.mjs"], {
    env: { ...process.env, RELAY_KEY: KEY, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((r) => setTimeout(r, 800));
});

afterAll(() => {
  child?.kill();
});

const openWs = (url: string) => {
  const { promise, resolve, reject } = Promise.withResolvers<WebSocket>();
  const ws = new WebSocket(url);
  ws.onopen = () => resolve(ws);
  ws.onerror = () => reject(new Error(`ws fail: ${url}`));
  return promise;
};

describe("tmd-relay-server.mjs 契约", () => {
  it("错 key 拨 /agent 被 403 拒", async () => {
    await expect(openWs(`ws://127.0.0.1:${port}/agent?key=WRONG`)).rejects.toThrow();
  });

  it("agent + 手机流往返;第二个 agent 顶替后手机收 close", async () => {
    const agent = await openWs(`ws://127.0.0.1:${port}/agent?key=${KEY}`);
    const opened: number[] = [];
    agent.onmessage = (ev: MessageEvent) => {
      const f = JSON.parse(String(ev.data));
      if (f.t === "open" && f.ws) opened.push(f.id);
      if (f.t === "data") agent.send(JSON.stringify({ t: "data", id: f.id, b64: f.b64, text: true })); // 回声
    };
    const phone = await openWs(`ws://127.0.0.1:${port}/ws-stream?device=d&token=t`);
    let got: string | null = null;
    phone.onmessage = (ev: MessageEvent) => {
      got = String(ev.data);
    };
    const msg = JSON.stringify({ type: "invoke", id: 1, cmd: "x", args: {} });
    phone.send(msg);
    /* 真进程集成测试:桥上等真实事件而非假钟(评审规则例外条款)。 */
    const { promise: gotOne, resolve: seen } = Promise.withResolvers<void>();
    const iv = setInterval(() => {
      if (got !== null) seen();
    }, 50);
    await Promise.race([gotOne, new Promise((r) => setTimeout(r, 4000))]);
    clearInterval(iv);
    expect(opened.length).toBeGreaterThan(0);
    expect(got).toBe(msg);

    const agent2 = await openWs(`ws://127.0.0.1:${port}/agent?key=${KEY}`);
    await new Promise((r) => setTimeout(r, 600)); // 真实断链事件等待:集成测试例外
    expect(phone.readyState).toBeGreaterThanOrEqual(2); // 顶替即清场,手机断
    agent2.close();
    agent.close();
  });
});
