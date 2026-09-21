#!/usr/bin/env node
/**
 * web-bridge-client.mjs —— 配对协议客户端脚本(手机壳的协议替身)。
 *
 * 用法:
 *   node scripts/web-bridge-client.mjs --offer "tmd://pair?c=…" [--name 设备名]
 *   node scripts/web-bridge-client.mjs --url http://192.168.1.5:61234 --code XXXX-XXXX [--name 名字]
 *   node scripts/web-bridge-client.mjs --url ws://… --device ID --token TK     # 直连已配对凭证
 * 选项:
 *   --listen-secs N   连上后旁听事件 N 秒(默认 5)再退出
 *   --relay           offer 同时带 lan/relay 时优先走 relay(默认 LAN 优先)
 *
 * 行为:POST /pair → (4001/pending 时轮询等授权)→ WS 设备凭据连上 →
 * hello(capabilities)→ invoke session_list → 旁听事件 → 正常退出。
 * 4001/revoked = 桌面撤销,退出码 42;其他失败退出码 1。
 */

const args = process.argv.slice(2);
const flag = (k) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (k) => args.includes(`--${k}`);
const name = flag("name") ?? "protocol-client";
const listenSecs = Number(flag("listen-secs") ?? 5);
const preferRelay = has("relay");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function die(msg) {
  console.error(`[e2e] ${msg}`);
  process.exit(1);
}

// ── 端点与凭据解析 ──
let pairCode, httpBase, creds;
{
  const offer = flag("offer");
  const url = flag("url");
  if (offer) {
    const m = /^tmd:\/\/pair\?c=(.+)$/.exec(offer);
    if (!m) die(`offer 形状不对: ${offer}`);
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(m[1])));
    console.log(`[e2e] offer 解析:host=${payload.name} hostId=${payload.hostId} code=${payload.pairCode}`);
    const endpoints = preferRelay
      ? [payload.relay, payload.lan].filter(Boolean)
      : [payload.lan, payload.relay].filter(Boolean);
    if (!endpoints.length) die("offer 里没有可用端点");
    pairCode = payload.pairCode;
    httpBase = endpoints[0].replace(/\/+$/, "");
  } else if (url && flag("device") && flag("token")) {
    creds = { wsBase: url.replace(/\/+$/, ""), deviceId: flag("device"), token: flag("token") };
  } else if (url && flag("code")) {
    pairCode = flag("code");
    httpBase = url.replace(/\/+$/, "");
  } else {
    die("需要 --offer,或 --url+--code,或 --url+--device+--token");
  }
}

function b64urlDecode(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function pair(deviceName) {
  const resp = await fetch(`${httpBase}/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pairCode, deviceName }),
  });
  if (resp.status === 200) {
    const j = await resp.json();
    console.log(`[e2e] 配对成功:deviceId=${j.deviceId} host=${j.name} v${j.version}`);
    return { wsBase: httpBase.replace(/^http/, "ws"), deviceId: j.deviceId, token: j.deviceToken };
  }
  if (resp.status === 403) die("配对码不正确(403)");
  if (resp.status === 410) die("配对码已过期(410)");
  if (resp.status === 429) die("被节流(429)");
  die(`/pair 异常:${resp.status}`);
}

/** 连 WS;pending(4001)时按提示轮询重试,直到授权或超时。 */
async function connectUntilHello(creds0, deadlineMs) {
  let c = creds0;
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    const ws = new WebSocket(
      `${c.wsBase}/ws?device=${encodeURIComponent(c.deviceId)}&token=${encodeURIComponent(c.token)}`,
    );
    ws.binaryType = "arraybuffer";
    const result = await new Promise((resolve) => {
      const t = setTimeout(() => resolve({ kind: "timeout" }), 8000);
      ws.onopen = () => clearTimeout(t);
      ws.onmessage = (e) => {
        const text = typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data);
        let msg;
        try {
          msg = JSON.parse(text);
        } catch {
          return;
        }
        if (msg.type === "hello") resolve({ kind: "hello", hello: msg, ws });
      };
      ws.onclose = (e) => {
        clearTimeout(t);
        resolve({ kind: e.code === 4001 ? "pending-or-revoked" : "closed", code: e.code });
      };
      ws.onerror = () => {};
    });
    if (result.kind === "hello") return result;
    if (result.kind === "pending-or-revoked" && Date.now() < deadline) {
      console.log("[e2e] 4001:等待桌面授权(pending)…3s 后重试");
      await sleep(3000);
      continue;
    }
    die(`连接失败:${result.kind}`);
  }
}

const events = [];
async function main() {
  if (!creds) creds = await pair(name);
  const { hello, ws } = await connectUntilHello(creds, 120_000);
  console.log(`[e2e] hello:version=${hello.version} capabilities=${JSON.stringify(hello.capabilities)}`);

  const done = new Promise((resolve) => {
    ws.onmessage = (e) => {
      const text = typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data);
      let msg;
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }
      if (msg.type === "event") {
        events.push(msg.event);
        return;
      }
      if (msg.type === "response" && msg.id === 1) {
        console.log(`[e2e] session_list 响应:ok=${msg.ok}${msg.ok ? ` 会话数=${(msg.payload ?? []).length}` : ` error=${msg.error}`}`);
        resolve();
      }
      if (msg.type === "close" || msg.type === undefined) resolve();
    };
    ws.onclose = (e) => {
      console.log(`[e2e] 连接关闭:code=${e.code}`);
      if (e.code === 4001) process.exit(42);
      resolve();
    };
  });

  ws.send(JSON.stringify({ type: "invoke", id: 1, cmd: "session_list", args: {} }));
  await sleep(listenSecs * 1000);
  console.log(`[e2e] ${listenSecs}s 旁听事件 ${events.length} 条${events.length ? `:${[...new Set(events)].slice(0, 8).join(", ")}` : ""}`);
  ws.close(1000);
  await done;
  console.log("[e2e] 通过");
}

main().catch((e) => die(e?.stack ?? String(e)));
