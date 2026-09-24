#!/usr/bin/env node
import fs from "node:fs";
/**
 * tmd-relay —— 自建外网中继(Node 单文件,零依赖)。
 *
 * 与 Cloudflare Worker 版(src-tauri/deploy/worker/src/index.js)同一套线协议:
 *   桌面端外拨  ws://host:PORT/agent?key=RELAY_KEY  保持一条长连;
 *   手机请求    http://host:PORT/*  成为长连上的一条多路复用流。
 * 帧协议(t 字段判别):
 *   agent→relay: open{id,ws?,method,path,headers} body{id,b64} end{id} data{id,b64,text} close{id}
 *   relay→agent: head{id,status,headers} data{id,b64,text} close{id} error{id,message}
 * 桌面 agent 发 WS ping 心跳,本服务自动 pong;30s 无任何字节才踢线(桌面会自动重拨)。
 *
 * 用法: RELAY_KEY=xxx PORT=8787 node tmd-relay-server.mjs
 */

import http from "node:http";
import https from "node:https";
import crypto from "node:crypto";

const PORT = Number(process.env.PORT || 8787);
const RELAY_KEY = process.env.RELAY_KEY || "";
if (!RELAY_KEY) {
  console.error("RELAY_KEY 未设置,拒绝启动");
  process.exit(1);
}

/* ==================== 极简 RFC6455 ==================== */

const OP = { cont: 0x0, text: 0x1, binary: 0x2, close: 0x8, ping: 0x9, pong: 0xa };
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function wsAccept(key) {
  return crypto.createHash("sha1").update(key + GUID).digest("base64");
}

function wsFrame(opcode, payload) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function makeParser(maxFrame) {
  let buf = Buffer.alloc(0);
  let fragments = [];
  let fragOpcode = 0;
  let fragTotal = 0;
  return {
    feed(chunk) {
      buf = Buffer.concat([buf, chunk]);
      const out = [];
      for (;;) {
        if (buf.length < 2) break;
        const fin = (buf[0] & 0x80) !== 0;
        const opcode = buf[0] & 0x0f;
        const masked = (buf[1] & 0x80) !== 0;
        let len = buf[1] & 0x7f;
        let off = 2;
        if (len === 126) {
          if (buf.length < off + 2) break;
          len = buf.readUInt16BE(off);
          off += 2;
        } else if (len === 127) {
          if (buf.length < off + 8) break;
          const big = buf.readBigUInt64BE(off);
          if (big > 32n * 1024n * 1024n) throw new Error("frame too large");
          len = Number(big);
          off += 8;
        }
        /* RFC6455:控制帧不分片、载荷 ≤125B;协议帧只可能是小 JSON,
         * 大Declared/碎片流 = DoS 滴灌,头部期即拒,不等 payload 灌满。 */
        if (opcode >= 0x8 && len > 125) throw new Error("control frame too large");
        if (len > maxFrame) throw new Error("frame too large");
        if (masked) off += 4;
        if (buf.length < off + len) break;
        let payload = Buffer.from(buf.subarray(off, off + len));
        if (masked) {
          const mask = buf.subarray(off - 4, off);
          for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
        }
        buf = buf.subarray(off + len);
        if (opcode === OP.close || opcode === OP.ping || opcode === OP.pong) {
          out.push({ opcode, payload });
          continue;
        }
        if (opcode !== OP.cont) {
          fragOpcode = opcode;
          fragments = [payload];
          fragTotal = payload.length;
        } else {
          fragTotal += payload.length;
          if (fragTotal > maxFrame) throw new Error("fragmented message too large");
          fragments.push(payload);
        }
        if (fin) {
          out.push({ opcode: fragOpcode, payload: Buffer.concat(fragments) });
          fragments = [];
          fragTotal = 0;
        }
      }
      return out;
    },
  };
}

/** socket → {send,close,onMessage,onClose,onActivity};自动回 pong。
 * 背压:向本端写 congested(write 返回 false)时暂停对端读——停摄入即停转发,
 * 否则慢消费端把中继当无限缓冲灌爆(公网 443 无门禁,必须自保)。 */
function wrapSocket(sock, head, maxFrame) {
  const parser = makeParser(maxFrame);
  let readPaused = false;
  const state = {
    closed: false,
    onMessage: () => {},
    onClose: () => {},
    onActivity: () => {},
    send(data, isText = true) {
      if (state.closed) return true;
      try {
        const ok = sock.write(wsFrame(isText ? OP.text : OP.binary, Buffer.from(data)));
        if (ok === false && !readPaused) {
          readPaused = true;
          sock.pause();
          sock.once("drain", () => {
            readPaused = false;
            if (!state.closed) sock.resume();
          });
        }
        return ok !== false;
      } catch {
        state.destroy();
        return false;
      }
    },
    /** 本端 socket 当前未刷出字节数(背压水位判定用)。 */
    writableLength: () => (state.closed ? 0 : sock.writableLength),
    ping() {
      if (state.closed) return;
      try {
        sock.write(wsFrame(OP.ping, Buffer.alloc(0)));
      } catch {}
    },
    close() {
      if (state.closed) return;
      try {
        sock.write(wsFrame(OP.close, Buffer.alloc(0)));
      } catch {}
      state.destroy();
    },
    destroy() {
      if (state.closed) return;
      state.closed = true;
      try {
        sock.destroy();
      } catch {}
      state.onClose();
    },
  };
  const onData = (chunk) => {
    state.onActivity();
    let frames;
    try {
      frames = parser.feed(chunk);
    } catch {
      return state.destroy();
    }
    for (const f of frames) {
      if (f.opcode === OP.ping) {
        try {
          sock.write(wsFrame(OP.pong, f.payload));
        } catch {}
      } else if (f.opcode === OP.close) return state.destroy();
      else if (f.opcode === OP.text || f.opcode === OP.binary) state.onMessage(f.payload);
    }
  };
  sock.on("data", onData);
  sock.on("error", state.destroy);
  sock.on("close", state.destroy);
  if (head && head.length) onData(head);
  return state;
}

function upgrade(req, socket, head, onOpen, maxFrame) {
  const key = req.headers["sec-websocket-key"];
  if (!key) {
    log(`upgrade rejected: no ws key ${req.url}`);
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    return;
  }
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${wsAccept(key)}\r\n\r\n`,
  );
  socket.setNoDelay(true);
  onOpen(wrapSocket(socket, head, maxFrame));
}

/* ==================== 中继核心(与 Worker 同语义) ==================== */

let agent = null; // {ws, lastSeen}
let nextId = 1;
const streams = new Map(); // id -> {kind,res?,ws?,headersSent?,timer?}
function log(msg) {
  console.log(new Date().toISOString(), msg);
}

const HEAD_TIMEOUT = 30_000;
const PHONE_PING_MS = 20_000;
const IDLE_KILL = 45_000; // 桌面心跳 15s 一次;45s 无任何字节 = 死链
/* 帧上限:agent 向 = 桌面 b64 大帧(文件读)沿 32MiB 现状;手机向 = 纯 JSON 线帧。 */
const AGENT_MAX_FRAME = 32 * 1024 * 1024;
const PHONE_MAX_FRAME = 4 * 1024 * 1024;
/* 流量闸:公网手机流在中继层零鉴权(门禁在桌面桥),防灌爆自保。 */
const MAX_STREAMS = 64;
const MAX_STREAM_TO_PHONE = 8 * 1024 * 1024; // 单流 desk→phone 积压上限
const MAX_STREAM_FROM_PHONE = 32 * 1024 * 1024; // 单流 phone→desk 总量上限(合法路径全是小 JSON)
const MAX_AGENT_BACKLOG = 64 * 1024 * 1024; // agent socket 积压:超 = 桌面链路死亡,全员清场
const agentAlive = () => agent && !agent.ws.closed;

function toAgent(obj) {
  if (!agentAlive()) return;
  /* agent socket 积压超限 = 桌面链路死亡(不读):全员清场防中继变无限缓冲。 */
  if (agent.ws.writableLength() > MAX_AGENT_BACKLOG) {
    for (const id of [...streams.keys()]) killStream(id, "agent backpressure");
    return;
  }
  try {
    agent.ws.send(JSON.stringify(obj));
  } catch {}
}

function killStream(id, message) {
  const s = streams.get(id);
  if (!s) return;
  log(`stream#${id} killed${message ? `: ${message}` : ""} (${s.t0 ? Date.now() - s.t0 : "?"}ms) phone→ ${s.fromPhone ?? 0}B desk→ ${s.toPhone ?? 0}B`);
  streams.delete(id);
  clearTimeout(s.timer);
  if (s.kind === "http") {
    if (!s.headersSent) {
      try {
        s.res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      } catch {}
    }
    try {
      s.res.end(message ? String(message) : "");
    } catch {}
  } else if (s.ws) {
    try {
      s.ws.close();
    } catch {}
  }
}

function onAgentFrame(raw) {
  let frame;
  try {
    frame = JSON.parse(raw.toString("utf8"));
  } catch {
    return;
  }
  const s = streams.get(frame.id);
  if (!s) return;
  switch (frame.t) {
    case "head": {
      if (s.kind !== "http" || s.headersSent) return;
      s.headersSent = true;
      clearTimeout(s.timer);
      try {
        s.res.writeHead(frame.status, frame.headers || {});
      } catch {}
      break;
    }
    case "data": {
      const bytes = Buffer.from(frame.b64, "base64");
      if (s.kind === "http") {
        try {
          s.res.write(bytes);
        } catch {}
      } else if (s.ws) {
        s.toPhone += bytes.length;
        /* 手机慢排水:ws.send 背压自身停摄入只挡 phone→desk 向;desk→phone 向
         * 源在 agent,只能按单流积压水位杀——超限即手机死链,清场让它重连。 */
        if (s.ws.writableLength() > MAX_STREAM_TO_PHONE) {
          killStream(frame.id, "phone backpressure");
          return;
        }
        if (frame.text === false) s.ws.send(bytes, false);
        else s.ws.send(bytes.toString("utf8"), true);
      }
      break;
    }
    case "close": {
      if (s.kind === "http") {
        clearTimeout(s.timer);
        streams.delete(frame.id);
        log(`http#${frame.id} ${s.path} done ${Date.now() - s.t0}ms`);
        try {
          s.res.end();
        } catch {}
      } else {
        killStream(frame.id);
      }
      break;
    }
    case "error":
      log(`stream#${frame.id} agent-error: ${frame.message ?? "closed"}`);
      killStream(frame.id, frame.message ?? "relay stream closed");
      break;
  }
}

const DROP_REQ_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "upgrade",
  "transfer-encoding",
  "content-length",
  "accept-encoding",
]);
const DROP_WS_HEADERS = new Set([...DROP_REQ_HEADERS, "sec-websocket-key", "sec-websocket-version", "sec-websocket-extensions"]);

function copyHeaders(req, drop) {
  const headers = {};
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    const lower = req.rawHeaders[i].toLowerCase();
    if (drop.has(lower)) continue;
    headers[lower] = req.rawHeaders[i + 1];
  }
  return headers;
}

function serveHttp(req, res) {
  if (!agentAlive()) {
    res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
    res.end("tmd-cli 桌面端未连接到中继。请在电脑上打开 tmd-cli → 设置 → Web 访问 → 外网,点「连接中继」。");
    return;
  }
  if (streams.size >= MAX_STREAMS) {
    res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
    res.end("relay busy");
    return;
  }
  const url = new URL(req.url, "http://x");
  const id = nextId++;
  /* 日志只落 pathname:query 带活体 token/配对码,不能进 journalctl。 */
  const s = { kind: "http", res, headersSent: false, timer: null, t0: Date.now(), path: url.pathname };
  streams.set(id, s);
  toAgent({ t: "open", id, method: req.method, path: req.url, headers: copyHeaders(req, DROP_REQ_HEADERS) });
  req.on("data", (chunk) => toAgent({ t: "body", id, b64: chunk.toString("base64") }));
  req.on("end", () => {
    toAgent({ t: "end", id });
    s.timer = setTimeout(() => {
      toAgent({ t: "close", id });
      killStream(id, "relay timeout");
    }, HEAD_TIMEOUT);
  });
  res.on("close", () => {
    if (streams.get(id) === s) {
      toAgent({ t: "close", id });
      killStream(id);
    }
  });
}

function serveWs(req, socket, head) {
  if (!agentAlive()) {
    log(`ws rejected, no agent: ${new URL(req.url, "http://x").pathname}`);
    socket.end("HTTP/1.1 503 Service Unavailable\r\n\r\n");
    socket.destroy();
    return;
  }
  if (streams.size >= MAX_STREAMS) {
    log(`ws rejected, streams full (${streams.size})`);
    socket.end("HTTP/1.1 503 Service Unavailable\r\n\r\n");
    socket.destroy();
    return;
  }
  const url = new URL(req.url, "http://x");
  const id = nextId++;
  upgrade(req, socket, head, (phoneWs) => {
    // 蜂窝/CGNAT 30-90s 掐空闲 TCP:浏览器 WS 发不了协议 ping,由中继代ping 撑活这一跳。
    const keep = setInterval(() => phoneWs.ping(), PHONE_PING_MS);
    const s = { kind: "ws", ws: phoneWs, t0: Date.now(), path: url.pathname, fromPhone: 0, toPhone: 0, phoneMsgs: 0 };
    streams.set(id, s);
    log(`ws#${id} ${url.pathname} open`);
    toAgent({ t: "open", id, ws: true, path: req.url, headers: copyHeaders(req, DROP_WS_HEADERS) });
    const cmdHist = new Map();
    phoneWs.onMessage = (payload) => {
      s.fromPhone += payload.length;
      /* 手机向合法帧全是小 JSON 线帧;超总量 = 滥用,清场。 */
      if (s.fromPhone > MAX_STREAM_FROM_PHONE) {
        killStream(id, "phone flood");
        return;
      }
      if (++s.phoneMsgs % 50 === 0) {
        try {
          const m = JSON.parse(payload.toString("utf8"));
          if (m.type === "invoke") cmdHist.set(m.cmd, (cmdHist.get(m.cmd) ?? 0) + 1);
        } catch {}
        log(`ws#${id} phone burst: ${s.phoneMsgs} msgs; cmds=${JSON.stringify(Object.fromEntries(cmdHist))}`);
      }
      toAgent({ t: "data", id, b64: payload.toString("base64"), text: true });
    };
    phoneWs.onClose = () => {
      clearInterval(keep);
      const s = streams.get(id);
      if (s) log(`ws#${id} phone-close ${Date.now() - s.t0}ms phone→ ${s.fromPhone}B desk→ ${s.toPhone}B`);
      toAgent({ t: "close", id });
      streams.delete(id);
    };
  }, PHONE_MAX_FRAME);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(agentAlive() ? "agent connected\n" : "no agent\n");
    return;
  }
  serveHttp(req, res);
});

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/agent") {
    const supplied = url.searchParams.get("key") ?? "";
    const a = Buffer.from(supplied);
    const b = Buffer.from(RELAY_KEY);
    const keyOk = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!keyOk) {
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    upgrade(req, socket, head, (ws) => {
      if (agent) {
        try {
          agent.ws.close();
        } catch {}
      }
      agent = { ws, lastSeen: Date.now() };
      /* 顶替即清场:旧 agent 名下全部流对新 agent 是未知 id,双向数据全黑洞;
       * 杀流让手机端收 close 事件自行重连(与断连清场同语义,fake-relay 同款)。 */
      for (const id of [...streams.keys()]) killStream(id, "agent replaced");
      ws.onActivity = () => (agent ? (agent.lastSeen = Date.now()) : null);
      ws.onMessage = (payload) => onAgentFrame(payload);
      ws.onClose = () => {
        if (agent && agent.ws !== ws) return; // 被新拨号顶替的旧 socket:无权清场
        agent = null;
        console.log(new Date().toISOString(), "agent disconnected");
        for (const id of [...streams.keys()])
          killStream(id, "agent disconnected");
      };
      console.log(new Date().toISOString(), "agent connected");
    }, AGENT_MAX_FRAME);
    return;
  }
  serveWs(req, socket, head);
});

setInterval(() => {
  if (agent && Date.now() - agent.lastSeen > IDLE_KILL) {
    console.log(new Date().toISOString(), "agent idle, dropping");
    try {
      agent.ws.close();
    } catch {}
  }
}, 5000).unref();

server.listen(PORT, () => {
  console.log(`tmd-relay listening on :${PORT}`);
});
// 443 双监听:运营商蜂窝透明代理吞 80 端口的 WS upgrade;443 不碰明文。
if (process.env.EXTRA_PORT) {
  const mirror = http.createServer((req, res) => {
    for (const f of server.listeners("request")) f(req, res);
  });
  mirror.on("upgrade", (req, socket, head) => {
    for (const f of server.listeners("upgrade")) f(req, socket, head);
  });
  mirror.listen(Number(process.env.EXTRA_PORT), () =>
    console.log("tmd-relay listening on :" + process.env.EXTRA_PORT));
}

// relay-tls:443 真 TLS。运营商对所有端口做 WS 深包检测,明文 upgrade 一律吞;
// 加密后中间设备无法解析只能透传。自签证书 + 双端证书锁定。
try {
  const tlsServer = https.createServer(
    { key: fs.readFileSync("/opt/tmd-relay/relay-key.pem"), cert: fs.readFileSync("/opt/tmd-relay/relay-cert.pem") },
    (req, res) => { for (const f of server.listeners("request")) f(req, res); }
  );
  tlsServer.on("upgrade", (req, socket, head) => {
    for (const f of server.listeners("upgrade")) f(req, socket, head);
  });
  tlsServer.listen(443, () => console.log("tmd-relay listening on :443 (tls)"));
} catch (e) { console.log("tls listen failed:", e.message); }
