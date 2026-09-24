#!/usr/bin/env node
/**
 * fake-relay.mjs —— 本地假 Cloudflare Worker(deploy/worker/src/index.js 的协议仿真),
 * 用于无 CF 账号时的 relay 链路 e2e:桌面 relay_agent 拨 /agent?key=,手机(协议脚本)
 * 经它转发到桌面桥。只搬运字节,门禁全部在桌面桥内,与真 Worker 同一契约。
 *
 * 用法:bun scripts/fake-relay.mjs [--port 8787] [--key <relayKey>]
 * 配套:桌面 settings {webRelayUrl:"http://127.0.0.1:8787", webRelayKey:<key>, webRelayOn:true}
 * 后重启桌面(autostart 自动拨号),再用 web-bridge-client.mjs --relay 走 relay 配对。
 */
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: { port: { type: "string", default: "8787" }, key: { type: "string", default: "e2e-relay-key" } },
});
const PORT = Number(values.port);
const KEY = values.key;

/** 每 key 一个 agent 仿真(单 key 版:Durable Object 的本地等价)。 */
const state = {
  agent: null, // WebSocket
  nextId: 1,
  /** id → deliver(t, frame) */
  streams: new Map(),
};
const SKIP = new Set([
  "host", "cf-connecting-ip", "cf-ray", "upgrade", "connection",
  "sec-websocket-key", "sec-websocket-version", "sec-websocket-extensions",
  // 桌面侧 reqwest 按实际 body 重算 content-length;转发旧值会同帧重复,hyper 400
  "content-length",
]);

function sendToAgent(frame) {
  if (process.env.FAKE_RELAY_TRACE) console.log(`[trace] →agent ${JSON.stringify(frame).slice(0, 240)}`);
  if (state.agent && state.agent.readyState === 1) state.agent.send(JSON.stringify(frame));
}

function onAgentFrame(raw) {
  let frame;
  try {
    frame = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
  } catch {
    return;
  }
  if (process.env.FAKE_RELAY_TRACE) console.log(`[trace] ←agent ${JSON.stringify(frame).slice(0, 240)}`);
  state.streams.get(frame.id)?.(frame.t, frame);
}

Bun.serve({
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);

    if (url.pathname === "/agent") {
      if (url.searchParams.get("key") !== KEY) return new Response("forbidden", { status: 403 });
      if (server.upgrade(req, { data: { role: "agent" } })) return undefined;
      return new Response("upgrade failed", { status: 500 });
    }

    if (!state.agent || state.agent.readyState !== 1) {
      return new Response("tmd-cli 桌面端未连接到中继", { status: 503 });
    }

    const id = state.nextId++;
    const headers = {};
    for (const [k, v] of req.headers) if (!SKIP.has(k.toLowerCase())) headers[k] = v;
    const path = url.pathname + url.search;
    const isWs = req.headers.get("upgrade") === "websocket";

    /* 实况 socket:双向裸帧。 */
    if (isWs) {
      if (server.upgrade(req, { data: { role: "client", id, path, headers } })) return undefined;
      return new Response("upgrade failed", { status: 500 });
    }

    /* HTTP:请求头 + 体入,响应头 + 块出。close 帧才收口 —— head 先到而 data 在途,
    提前返回会把 body 丢在无读者的 deliverer 里。 */
    const body = new Uint8Array(await req.arrayBuffer());
    const done = Promise.withResolvers();
    let head = null;
    const chunks = [];
    let errMsg = null;
    state.streams.set(id, (t, f) => {
      if (t === "head") head = f;
      else if (t === "data") chunks.push(Buffer.from(f.b64, "base64"));
      else if (t === "close" || t === "error") {
        errMsg = f.message ?? "relay stream closed";
        done.resolve();
      }
    });
    sendToAgent({ t: "open", id, method: req.method, path, headers });
    if (body.length) sendToAgent({ t: "body", id, b64: Buffer.from(body).toString("base64") });
    sendToAgent({ t: "end", id });
    const expired = await Promise.race([
      done.promise.then(() => false),
      new Promise((r) => setTimeout(() => r(true), 15000)),
    ]);
    state.streams.delete(id);
    if (expired) {
      sendToAgent({ t: "close", id });
      return new Response("relay timeout", { status: 504 });
    }
    if (!head) return new Response(errMsg ?? "relay stream closed", { status: 502 });
    return new Response(Buffer.concat(chunks), { status: head.status, headers: head.headers ?? {} });
  },

  websocket: {
    open(ws) {
      const d = ws.data;
      if (d.role === "agent") {
        /* 重连的桌面顶掉旧 socket,否则手机对着没人读的管道说话。 */
        if (state.agent && state.agent !== ws) {
          try { state.agent.close(1012, "replaced by a new agent connection"); } catch {}
          for (const deliver of state.streams.values()) deliver("close", {});
          state.streams.clear();
        }
        state.agent = ws;
        console.log(`[fake-relay] agent 已连接`);
      } else {
        state.streams.set(d.id, (t, f) => {
          if (t === "data") {
            const buf = Buffer.from(f.b64, "base64");
            ws.send(f.text === false ? buf : buf.toString("utf8"));
          } else if (t === "close" || t === "error") {
            state.streams.delete(d.id);
            try { ws.close(1012, "relay stream closed"); } catch {}
          }
        });
        sendToAgent({ t: "open", id: d.id, ws: true, path: d.path, headers: d.headers });
        console.log(`[fake-relay] client ws 流 #${d.id} → ${d.path}`);
      }
    },
    message(ws, msg) {
      const d = ws.data;
      if (d.role === "agent") {
        onAgentFrame(msg);
      } else {
        const isText = typeof msg === "string";
        sendToAgent({ t: "data", id: d.id, b64: Buffer.from(msg).toString("base64"), text: isText });
      }
    },
    close(ws) {
      const d = ws.data;
      if (d.role === "agent") {
        if (state.agent === ws) {
          state.agent = null;
          for (const deliver of state.streams.values()) deliver("close", {});
          state.streams.clear();
          console.log(`[fake-relay] agent 断开`);
        }
      } else {
        state.streams.delete(d.id);
        sendToAgent({ t: "close", id: d.id });
      }
    },
  },
});

console.log(`[fake-relay] ws://127.0.0.1:${PORT}  key=${KEY}`);
