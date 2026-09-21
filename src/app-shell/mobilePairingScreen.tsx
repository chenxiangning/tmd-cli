/**
 * 移动壳配对屏 + 壳屏底:粘贴 tmd://pair 链接或手输地址+配对码,POST /pair。
 * 视觉对齐 docs/prototypes/mobile-app-device-edge-states.html 撤销屏(暗底)。
 */
import React from "react";
import type { MobileCreds } from "./mobilePairing";


/** 解析 tmd://pair?c=… 短链;非该形状返回 null。 */
function parseOfferLink(text: string): { code: string; url: string; hostName: string } | null {
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
    const url = payload.lan || payload.relay;
    if (!payload.pairCode || !url) return null;
    return { code: payload.pairCode, url, hostName: payload.name ?? "" };
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
      body: JSON.stringify({ pairCode: code.trim().toUpperCase(), deviceName }),
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

export function PairingScreen(props: { onPaired: (c: MobileCreds) => void }) {
  const [host_, setHost] = React.useState("");
  const [code, setCode] = React.useState("");
  const [hostName, setHostName] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const offer = parseOfferLink(host_);
      const url = offer ? offer.url : host_.trim();
      const pairCode = offer ? offer.code : code.trim();
      if (!/^https?:\/\//.test(url) || pairCode.length < 6) {
        setError("请填主机地址(http://…:端口)与 8 位配对码");
        return;
      }
      const r = await tryPair(url, pairCode, deviceName());
      if (r.creds) props.onPaired(r.creds);
      else setError(r.error ?? "配对失败");
    } finally {
      setBusy(false);
    }
  };

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
          if (offer) {
            setCode(offer.code);
            setHostName(offer.hostName);
          }
        }}
      />
      <input
        className="w-full rounded-xl border border-[#3a3a3c] bg-[#2c2c2e] px-3 py-2.5 text-center font-mono text-[1.0625rem] tracking-[0.3em] text-white placeholder:tracking-normal placeholder:text-[#636366]"
        aria-label="配对码"
        placeholder="配对码 XXXX-XXXX"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
      />
      {hostName && <div className="text-[0.75rem] text-[#98989f]">主机:{hostName}</div>}
      {error && <div className="text-[0.8125rem] text-[#ff453a]">{error}</div>}
      <button
        type="button"
        disabled={busy}
        onClick={() => void submit()}
        className="w-full rounded-xl bg-[#0a84ff] py-3 text-[0.9375rem] font-semibold text-white disabled:opacity-50"
      >
        {busy ? "配对中…" : "配对"}
      </button>
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
