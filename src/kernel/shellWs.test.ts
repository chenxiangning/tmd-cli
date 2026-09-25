/**
 * 壳 WS 隧道契约(open/message/close 回注 + send/close 意图):
 * open 意图带 url;open 回注升 readyState;文本与 base64 二进制帧 → onmessage;
 * close 回注带 code+reason;本地 close 后迟到 close 不再回调;send 仅 OPEN 放行。
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type Posted = { id: number; method: string; args?: Record<string, unknown> };

const posted: Posted[] = [];

vi.stubGlobal("window", {
  webkit: {
    messageHandlers: {
      shell: { postMessage: (m: unknown) => posted.push(m as Posted) },
    },
  },
});

let shellWs: typeof import("./shellWs");

beforeAll(async () => {
  // 动态 import:须在 window stub 生效后装载(分发器挂 window)
  shellWs = await import("./shellWs");
});

beforeEach(() => {
  posted.length = 0;
});

/** 建连并取回本次连接的 connId;fire = 以该 id 注入 Swift 回注帧。 */
function makeWs(url = "ws://h:1/ws") {
  const ws = shellWs.createShellWs(url);
  const id = (posted.at(-1)!.args as { id: number }).id;
  const fire = (ev: string, p?: object) =>
    (window as unknown as { __TMD_SHELL_WS__: (i: number, e: string, p?: object) => void })
      .__TMD_SHELL_WS__(id, ev, p);
  return { ws, fire };
}

describe("shellWs 隧道", () => {
  it("壳桥存在时可用", () => {
    expect(shellWs.shellWsAvailable()).toBe(true);
  });

  it("建连发 ws.open 意图;open 回注升 OPEN 态并触发 onopen", () => {
    const { ws, fire } = makeWs("ws://h:9/ws");
    expect(posted.at(-1)).toMatchObject({
      id: 0,
      method: "ws.open",
      args: { url: "ws://h:9/ws" },
    });
    expect(ws.readyState).toBe(shellWs.WS_CONNECTING);
    const onopen = vi.fn();
    ws.onopen = onopen;
    fire("open", {});
    expect(onopen).toHaveBeenCalledTimes(1);
    expect(ws.readyState).toBe(shellWs.WS_OPEN);
  });

  it("文本帧与 base64 二进制帧回注到 onmessage", () => {
    const { ws, fire } = makeWs();
    const seen: (string | ArrayBuffer)[] = [];
    ws.onmessage = (e) => {
      seen.push(e.data);
    };
    fire("open", {});
    fire("message", { data: "hello" });
    fire("message", { b64: btoa("hi") });
    expect(seen[0]).toBe("hello");
    expect(new TextDecoder().decode(seen[1] as ArrayBuffer)).toBe("hi");
  });

  it("close 回注带 code/reason,降 CLOSED 态", () => {
    const { ws, fire } = makeWs();
    const onclose = vi.fn();
    ws.onclose = onclose;
    fire("close", { code: 4001, reason: "revoked" });
    expect(onclose).toHaveBeenCalledWith({ code: 4001, reason: "revoked" });
    expect(ws.readyState).toBe(shellWs.WS_CLOSED);
  });

  it("本地 close 发意图;迟到 close 不再触发 onclose", () => {
    const { ws, fire } = makeWs();
    fire("open", {});
    const onclose = vi.fn();
    ws.onclose = onclose;
    ws.close(1000, "bye");
    expect(posted.at(-1)).toMatchObject({ method: "ws.close", args: { code: 1000 } });
    fire("close", { code: 1006 });
    expect(onclose).not.toHaveBeenCalled();
  });

  it("send 仅 OPEN 态放行,载荷原样进意图", () => {
    const { ws, fire } = makeWs();
    ws.send("early");
    expect(posted.filter((m) => m.method === "ws.send")).toHaveLength(0);
    fire("open", {});
    ws.send(JSON.stringify({ type: "invoke", id: 1 }));
    expect(posted.at(-1)).toMatchObject({
      method: "ws.send",
      args: { data: '{"type":"invoke","id":1}' },
    });
  });

  it("close 回注后同一连接的消息不再投递", () => {
    const { ws, fire } = makeWs();
    const seen: unknown[] = [];
    ws.onmessage = (e) => {
      seen.push(e.data);
    };
    fire("open", {});
    fire("close", { code: 1006 });
    fire("message", { data: "ghost" });
    expect(seen).toHaveLength(0);
  });
});
