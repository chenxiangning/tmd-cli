/**
 * 移动壳配对屏 + 壳屏底:扫码为主 —— 调壳原生 QR 扫描(webkit.messageHandlers.qr),
 * 解出 tmd://pair?c=… offer 后自动双端点竞速配对。无桥环境(浏览器开发态)退化为
 * 手动粘贴/输入表单。视觉对齐 docs/prototypes/mobile-app-device-edge-states.html。
 */
import React from "react";
import type { MobileCreds } from "./creds";
import { hasShellBridge, shellHttpPost } from "@kernel/shellBridge";

/** 解析 tmd://pair?c=… 短链;非该形状返回 null。 */
function parseOfferLink(
  text: string,
): { code: string; urls: string[]; hostName: string } | null {
  const m = /tmd:\/\/pair\?c=([A-Za-z0-9_-]+)/.exec(text.trim());
  if (!m) return null;
  try {
    const b64 = m[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    const payload = JSON.parse(json) as {
      pairCode?: string;
      lan?: string | null;
      relay?: string | null;
      name?: string;
    };
    const urls = [payload.lan, payload.relay].filter((u): u is string => typeof u === "string");
    if (!payload.pairCode || !urls.length) return null;
    return { code: payload.pairCode, urls, hostName: payload.name ?? "" };
  } catch {
    return null;
  }
}

async function tryPair(
  base: string,
  code: string,
  deviceName: string,
): Promise<{ creds?: MobileCreds; error?: string }> {
  const url = `${base.replace(/\/+$/, "")}/pair`;
  const body = JSON.stringify({ pairCode: code.trim(), deviceName });
  try {
    /* 壳内走原生 URLSession(自签中继证书钉住;WKWebView fetch 过不了
     * 自签校验)。浏览器/桌面开发态回落 fetch。 */
    const { status, body: text } = hasShellBridge()
      ? await shellHttpPost(url, body)
      : await fetchWithTimeout(url, body, 6000);
    if (status !== 200) {
      const map: Record<number, string> = {
        403: "配对码不正确",
        410: "配对码已过期,桌面重新出码",
        429: "尝试过多,稍后再试",
      };
      return { error: map[status] ?? `配对失败(${status})` };
    }
    const j = JSON.parse(text) as { deviceId: string; deviceToken: string; name: string };
    return {
      creds: {
        wsUrl: base.replace(/^http/, "ws"),
        deviceId: j.deviceId,
        token: j.deviceToken,
        hostName: j.name,
      },
    };
  } catch {
    return { error: "无法连接主机,检查地址与同一网络" };
  }
}

async function fetchWithTimeout(
  url: string,
  body: string,
  ms: number,
): Promise<{ status: number; body: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: ctrl.signal,
    });
    if (!resp.ok) return { status: resp.status, body: "" };
    return { status: resp.status, body: await resp.text() };
  } finally {
    clearTimeout(timer);
  }
}

function deviceName(): string {
  /* 壳注入的最终设备名(默认名已拼硬件标识,配对/重连共用)优先。 */
  const injected = window.__TMD_DEVICE_NAME__;
  if (injected?.trim()) return injected.trim().slice(0, 40);
  const ua = navigator.userAgent;
  if (/iPad/.test(ua)) return "iPad";
  if (/iPhone/.test(ua)) return "iPhone";
  return "手机";
}

/** 壳是否有原生扫码桥。 */
function hasQrBridge(): boolean {
  return typeof (window as { webkit?: { messageHandlers?: { qr?: unknown } } })
    .webkit?.messageHandlers?.qr !== "undefined";
}

/** 开原生扫码;取消返回 null。 */
function scanOfferLink(): Promise<string | null> {
  return new Promise((resolve) => {
    const w = window as unknown as { __TMD_QR__?: (t: string | null) => void };
    w.__TMD_QR__ = (t) => resolve(t);
    (
      (window as unknown as { webkit: { messageHandlers: { qr: { postMessage: (m: string) => void } } } })
        .webkit.messageHandlers.qr
    ).postMessage("start");
  });
}

/** offer → 端点竞速配对(先成先用);凭证存全部端点供 M2 双通道重选路。 */
async function pairWithOffer(offer: { code: string; urls: string[] }): Promise<MobileCreds> {
  const attempts = offer.urls.map((u) =>
    tryPair(u, offer.code, deviceName()).then((r) => {
      if (r.creds) return r;
      throw r;
    }),
  );
  try {
    const ok = await Promise.any(attempts);
    return {
      ...ok.creds!,
      urls: offer.urls.map((u) => u.replace(/^http/, "ws").replace(/\/+$/, "")),
    };
  } catch (agg) {
    const errs = (agg as AggregateError).errors as { error?: string }[];
    throw new Error(errs.map((e) => e?.error).find(Boolean) ?? "配对失败");
  }
}

export function PairingScreen(props: {
  onPaired: (c: MobileCreds) => void;
  /** 旧凭证仍在时的返回入口(连接面板「重新配对」进来,不想重扫可切回老连接)。 */
  savedHostName?: string | null;
  onCancel?: () => void;
}) {
  const bridge = hasQrBridge();
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  // 无桥(浏览器开发态)才出现的退化管理态
  const [manual, setManual] = React.useState(false);
  const [host_, setHost] = React.useState("");
  const [code, setCode] = React.useState("");

  const runOffer = async (text: string) => {
    const offer = parseOfferLink(text);
    if (!offer) {
      setError("二维码不是 tmd-cli 配对码,请扫桌面「Web 访问 → 设备」里的二维码");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      props.onPaired(await pairWithOffer(offer));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const scan = async () => {
    setError(null);
    const text = await scanOfferLink();
    if (text) await runOffer(text);
  };

  const submitManual = async () => {
    setError(null);
    const offer = parseOfferLink(host_);
    const urls = offer ? offer.urls : [host_.trim()].filter((u) => /^https?:\/\//.test(u));
    const pairCode = offer ? offer.code : code.trim();
    if (!urls.length || pairCode.length < 6) {
      setError("请填主机地址(http://…:端口)与 8 位配对码");
      return;
    }
    setBusy(true);
    try {
      props.onPaired(await pairWithOffer({ code: pairCode, urls }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /* 旧凭证仍在(从连接面板「重新配对」进来):返回入口,免重扫切回老连接。
     次级动作用细链接(与「扫码不便?」同层级);主机名截断防长文案撑爆按钮。 */
  const back = props.onCancel && (
    <button
      type="button"
      onClick={props.onCancel}
      className="m-fine"
      style={{ background: "none", border: "none", textDecoration: "underline" }}
    >
      不想重扫?返回 <span className="host-truncate">{props.savedHostName || "上次的连接"}</span>
    </button>
  );

  if (bridge && !manual) {
    return (
      <div className="m-center">
        <div className="m-title">连接你的 tmd-cli 桌面</div>
        <p className="m-sub">
          桌面端打开 设置 → Web 访问 → 设备,
          <br />
          扫描屏幕上的配对二维码。
        </p>
        {error && <div className="m-err">{error}</div>}
        <button type="button" disabled={busy} onClick={() => void scan()} className="m-btn">
          {busy ? "配对中…" : "扫码配对"}
        </button>
        <button
          type="button"
          onClick={() => setManual(true)}
          className="m-fine"
          style={{ background: "none", border: "none", textDecoration: "underline" }}
        >
          扫码不便?手动输入配对码
        </button>
        {back}
      </div>
    );
  }

  return (
    <div className="m-center">
      <div className="m-title">连接你的 tmd-cli 桌面</div>
      <p className="m-sub">
        桌面端打开 设置 → Web 访问 → 设备,出示配对码;
        <br />
        可直接把 tmd://pair 链接粘贴到下面的地址框。
      </p>
      <input
        className="field"
        style={{ width: "100%", fontSize: 14, padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 7, background: "var(--bg-input)", color: "var(--fg)" }}
        aria-label="配对链接或主机地址"
        placeholder="tmd://pair 链接 或 http://192.168.x.x:端口"
        value={host_}
        onChange={(e) => {
          setHost(e.target.value);
          const offer = parseOfferLink(e.target.value);
          if (offer) setCode(offer.code);
        }}
      />
      <input
        style={{ width: "100%", fontSize: 17, padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 7, background: "var(--bg-input)", color: "var(--fg)", textAlign: "center", fontFamily: "var(--mono)", letterSpacing: "0.3em", marginBottom: 12 }}
        aria-label="配对码"
        placeholder="配对码 XXXX-XXXX"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
      />
      {error && <div className="text-[0.8125rem] text-[#ff453a]">{error}</div>}
      <button
        type="button"
        disabled={busy}
        onClick={() => void submitManual()}
        className="m-btn"
        style={{ marginBottom: 8 }}
      >
        {busy ? "配对中…" : "配对"}
      </button>
      {bridge && (
        <button
          type="button"
          onClick={() => setManual(false)}
          className="mt-1 text-[0.75rem] text-[#636366] underline underline-offset-2"
        >
          返回扫码
        </button>
      )}
      {back}
      </div>
  );
}

/** 壳屏通用暗底(block/撤销屏;与原型 device-edge-states 同视觉)。 */
export function ShellPage(props: { children: React.ReactNode }) {
  return (
    <div className="m-center" style={{ background: "#1c1c1e", color: "#e5e5e7", gap: 12 }}>
      {props.children}
    </div>
  );
}
