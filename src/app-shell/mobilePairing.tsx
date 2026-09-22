/**
 * 移动壳配对门:`window.__TMD_SHELL__ === "mobile"`(壳注入脚本)时接管根装配。
 * 无凭证 → 配对屏;有凭证 → 连接门(等待授权轮询/桌面协议能力 block/被撤销回配对屏)
 * → hello 通过后装配主应用。凭证经 mobileCreds(钥匙串优先 + localStorage 迁移)。
 * 桌面/浏览器两态不进本模块(isMobileShell 为 false,main.tsx 直装主应用)。
 */
import React from "react";
import { configureRemoteEndpoint, onRemoteRevoked, serverCapabilities, serverVersion } from "@kernel/transport";
import { PairingScreen, ShellPage } from "./mobilePairingScreen";
import { loadChannelPin, persistCreds, resolveCreds, type MobileCreds } from "./mobileCreds";

/** 壳要求的桌面协议能力(hello.capabilities 缺此 = block 屏;协议破坏性变更时步进)。 */
const REQUIRED_CAPABILITY = "app-device";

export type { MobileCreds };
export { loadCreds } from "./mobileCreds";

declare global {
  interface Window {
    /** 壳 initialization_script 注入的移动壳标记。 */
    __TMD_SHELL__?: string;
  }
}

export function isMobileShell(): boolean {
  return typeof window !== "undefined" && window.__TMD_SHELL__ === "mobile";
}

type GateOutcome =
  | { kind: "hello"; version: string; caps: string[] }
  | { kind: "pending" }
  | { kind: "rejected" }
  | { kind: "timeout" };

/** 端点候选:钉选优先;auto = urls 序(配对时 LAN 在前),旧凭证回落单 wsUrl。 */
function endpointCandidates(creds: MobileCreds): string[] {
  const all = creds.urls?.length ? creds.urls : [creds.wsUrl];
  const pin = loadChannelPin();
  if (pin !== "auto" && all.includes(pin)) return [pin];
  return all;
}

/** 单端点连接尝试:hello / 4001(pending|rejected)/ 8s 超时(超时 = 换下一端点)。 */
async function connectOne(creds: MobileCreds, wsUrl: string): Promise<GateOutcome> {
  configureRemoteEndpoint({ ...creds, wsUrl });
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
  const timer = setTimeout(() => done({ kind: "timeout" }), 8_000);
  void serverVersion().then(async (v) => {
    if (v !== null) done({ kind: "hello", version: v, caps: await serverCapabilities() });
  });
  return promise;
}

/** 双通道竞速:按候选序尝试,超时换下一端点;pending/rejected 与端点无关,即返。 */
async function connectAttempt(creds: MobileCreds): Promise<GateOutcome> {
  const candidates = endpointCandidates(creds);
  for (const url of candidates) {
    const o = await connectOne(creds, url);
    if (o.kind !== "timeout" || candidates.length === 1) return o;
  }
  return { kind: "timeout" };
}

/** RemoteHostBar 重试/展示用:当前钉选解析出的首选端点。 */
export function currentEndpoint(creds: MobileCreds): string {
  return endpointCandidates(creds)[0];
}

/** 壳根:凭证解析中(钥匙串异步)= 空屏;无凭证 = 配对屏;有凭证 = 连接门。
 * 撤销后经 onRePair 清凭证回配对屏。 */
export function mountMobileShellGate(
  root: { render: (node: React.ReactNode) => void },
  mountApp: () => void,
): void {
  function ShellRoot() {
    /* undefined = 钥匙串解析中;null = 无凭证(配对屏) */
    const [creds, setCreds] = React.useState<MobileCreds | null | undefined>(undefined);
    const [gateKey, setGateKey] = React.useState(0);
    React.useEffect(() => {
      void resolveCreds().then(setCreds);
    }, []);
    if (creds === undefined) return null;
    if (!creds) {
      return (
        <PairingScreen
          onPaired={(c) => {
            void persistCreds(c);
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
          void persistCreds(null);
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
          if (!o.caps.includes(REQUIRED_CAPABILITY)) {
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
        : `桌面端协议不兼容(当前 ${version ?? "?"},缺 ${REQUIRED_CAPABILITY} 能力),请升级桌面端。`;
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
