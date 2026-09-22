/**
 * 移动壳配对屏 + 壳屏底:扫码为主 —— 调壳原生 QR 扫描(webkit.messageHandlers.qr),
 * 解出 tmd://pair?c=… offer 后自动双端点竞速配对。无桥环境(浏览器开发态)退化为
 * 手动粘贴/输入表单。视觉对齐 docs/prototypes/mobile-app-device-edge-states.html。
 */
import React from "react";
import type { MobileCreds } from "./mobilePairing";

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
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const resp = await fetch(`${base.replace(/\/+$/, "")}/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pairCode: code.trim(), deviceName }),
      signal: ctrl.signal,
    });
    if (resp.status !== 200) {
      const map: Record<number, string> = {
        403: "配对码不正确",
        410: "配对码已过期,桌面重新出码",
        429: "尝试过多,稍后再试",
      };
      return { error: map[resp.status] ?? `配对失败(${resp.status})` };
    }
    const j = (await resp.json()) as { deviceId: string; deviceToken: string; name: string };
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
  } finally {
    clearTimeout(timer);
  }
}

function deviceName(): string {
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

export function PairingScreen(props: { onPaired: (c: MobileCreds) => void }) {
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

  if (bridge && !manual) {
    return (
      <ShellPage>
        <div className="text-[1.375rem] font-bold">连接你的 tmd-cli 桌面</div>
        <p className="text-center text-[0.8125rem] leading-relaxed text-[#98989f]">
          桌面端打开 设置 → Web 访问 → 设备,
          <br />
          扫描屏幕上的配对二维码。
        </p>
        {error && <div className="text-[0.8125rem] text-[#ff453a]">{error}</div>}
        <button
          type="button"
          disabled={busy}
          onClick={() => void scan()}
          className="mt-2 w-full rounded-xl bg-[#0a84ff] py-3.5 text-[0.9375rem] font-semibold text-white disabled:opacity-50"
        >
          {busy ? "配对中…" : "扫码配对"}
        </button>
        <button
          type="button"
          onClick={() => setManual(true)}
          className="mt-1 text-[0.75rem] text-[#636366] underline underline-offset-2"
        >
          扫码不便?手动输入配对码
        </button>
      </ShellPage>
    );
  }

  return (
    <ShellPage>
      <div className="text-[1.375rem] font-bold">连接你的 tmd-cli 桌面</div>
      <p className="text-center text-[0.8125rem] leading-relaxed text-[#98989f]">
        桌面端打开 设置 → Web 访问 → 设备,出示配对码;
        <br />
        可直接把 tmd://pair 链接粘贴到下面的地址框。
      </p>
      <input
        className="w-full rounded-xl border border-[#3a3a3c] bg-[#2c2c2e] px-3 py-2.5 text-[0.9375rem] text-white placeholder:text-[#636366]"
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
        className="w-full rounded-xl border border-[#3a3a3c] bg-[#2c2c2e] px-3 py-2.5 text-center font-mono text-[1.0625rem] tracking-[0.3em] text-white placeholder:tracking-normal placeholder:text-[#636366]"
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
        className="w-full rounded-xl bg-[#0a84ff] py-3 text-[0.9375rem] font-semibold text-white disabled:opacity-50"
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
    </ShellPage>
  );
}

/** 壳屏通用暗底(与原型 mobile-app-device-edge-states 撤销屏同视觉)。 */
export function ShellPage(props: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-screen flex-col items-center justify-center gap-3 bg-[#1c1c1e] px-7 text-center text-[#e5e5e7]">
      {props.children}
    </div>
  );
}
