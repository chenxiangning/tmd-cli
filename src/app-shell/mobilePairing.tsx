/**
 * 移动壳配对门:`window.__TMD_SHELL__ === "mobile"`(壳 initialization_script 注入)
 * 时接管根装配。无凭证 → 配对屏;有凭证 → 连接门(等待授权轮询/桌面版本 block/
 * 被撤销回配对屏)→ hello 通过后装配主应用。
 * 凭证存壳 webview localStorage;app-data/钥匙串硬化在 M2(见 M1 proposal 方案取舍)。
 * 桌面/浏览器两态不进本模块(isMobileShell 为 false,main.tsx 直装主应用)。
 */
import React from "react";
import { configureRemoteEndpoint, onRemoteRevoked, serverVersion } from "@kernel/transport";
import { isNewerVersion } from "@shell/updateCheck";
import { PairingScreen, ShellPage } from "./mobilePairingScreen";

const CREDS_KEY = "tmd.mobile.creds.v1";
/** 壳要求的最低桌面版本(hello.version 低于此 = block 屏)。随 M1 发布目标步进。 */
const SHELL_MIN_DESKTOP_VERSION = "0.3.0";

export interface MobileCreds {
  wsUrl: string;
  deviceId: string;
  token: string;
  hostName: string;
}

declare global {
  interface Window {
    /** 壳 initialization_script 注入的移动壳标记(mobile-app/src-tauri/src/lib.rs)。 */
    __TMD_SHELL__?: string;
  }
}

export function isMobileShell(): boolean {
  if (typeof window === "undefined") return false;
  if (window.__TMD_SHELL__ === "mobile") return true;
  /* 诊断期临时通道:iOS 壳 initialization_script 疑似未注入,UA 兜底识别(定稿删除) */
  return /iPhone|iPad/i.test(navigator.userAgent) && !/Macintosh/i.test(navigator.userAgent);
}

function loadCreds(): MobileCreds | null {
  try {
    const raw = localStorage.getItem(CREDS_KEY);
    return raw ? (JSON.parse(raw) as MobileCreds) : null;
  } catch {
    return null;
  }
}

function saveCreds(c: MobileCreds | null) {
  if (c) localStorage.setItem(CREDS_KEY, JSON.stringify(c));
  else localStorage.removeItem(CREDS_KEY);
}

type GateOutcome =
  | { kind: "hello"; version: string }
  | { kind: "pending" }
  | { kind: "rejected" }
  | { kind: "timeout" };

/** 单次连接尝试:重臂桥,hello / 4001(pending|rejected)/ 12s 超时三选一。 */
async function connectAttempt(creds: MobileCreds): Promise<GateOutcome> {
  configureRemoteEndpoint(creds);
  const { promise, resolve } = Promise.withResolvers<GateOutcome>();
  let settled = false;
  const done = (o: GateOutcome) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    off();
    resolve(o);
  };
  const off = onRemoteRevoked((reason) =>
    done(reason === "pending" ? { kind: "pending" } : { kind: "rejected" }),
  );
  const timer = setTimeout(() => done({ kind: "timeout" }), 12_000);
  void serverVersion().then((v) => {
    if (v !== null) done({ kind: "hello", version: v });
  });
  return promise;
}

/** 壳根:无凭证 = 配对屏;有凭证 = 连接门。撤销后经 onRePair 清凭证回配对屏。 */
export function mountMobileShellGate(
  root: { render: (node: React.ReactNode) => void },
  mountApp: () => void,
): void {
  function ShellRoot() {
    const [creds, setCreds] = React.useState<MobileCreds | null>(loadCreds);
    const [gateKey, setGateKey] = React.useState(0);
    if (!creds) {
      return (
        <PairingScreen
          onPaired={(c) => {
            saveCreds(c);
            setCreds(c);
          }}
        />
      );
    }
    return (
      <ShellGate
        key={gateKey}
        creds={creds}
        mountApp={mountApp}
        onRePair={() => {
          saveCreds(null);
          setCreds(null);
          setGateKey((k) => k + 1);
        }}
      />
    );
  }
  root.render(<ShellRoot />);
}

function ShellGate(props: { creds: MobileCreds; mountApp: () => void; onRePair: () => void }) {
  const [phase, setPhase] = React.useState<"connecting" | "pending" | "block">("connecting");
  const [version, setVersion] = React.useState<string | null>(null);
  React.useEffect(() => {
    let alive = true;
    (async () => {
      for (;;) {
        if (!alive) return;
        const o = await connectAttempt(props.creds);
        if (!alive) return;
        if (o.kind === "hello") {
          if (isNewerVersion(SHELL_MIN_DESKTOP_VERSION, o.version)) {
            setVersion(o.version);
            setPhase("block");
            return; // block 屏重试 = reload 重走门
          }
          props.mountApp();
          return;
        }
        if (o.kind === "rejected") {
          props.onRePair();
          return;
        }
        setPhase(o.kind === "pending" ? "pending" : "connecting");
        await new Promise((r) => setTimeout(r, 4000));
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hint =
    phase === "pending"
      ? "已连上主机,等待桌面端点【授权】…"
      : phase === "connecting"
        ? `正在连接 ${props.creds.hostName}…`
        : `桌面版本过旧(当前 ${version ?? "?"},需要 ≥ ${SHELL_MIN_DESKTOP_VERSION}),请先升级桌面端。`;
  return (
    <ShellPage>
      <div className="text-[2rem]">⏳</div>
      <div className="text-[0.9375rem] font-semibold">{hint}</div>
      {phase === "block" && (
        <button
          type="button"
          onClick={() => location.reload()}
          className="mt-3 rounded-lg bg-[#0a84ff] px-5 py-2 text-[0.8125rem] font-semibold text-white"
        >
          重试
        </button>
      )}
    </ShellPage>
  );
}
