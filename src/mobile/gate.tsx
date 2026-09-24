/**
 * 手机根装配(独立 UI 树入口;桌面树在 src/app-shell,互不共享组件)。
 * 职责:凭证解析 → 无 = 配对屏 / 有 = MobileApp;撤销常驻订阅(清凭证回配对);
 * 回前台/可见强制重拨;hello 能力探测(block 屏)。
 * 连接态本身不设阻塞门 —— transport 自动重连,顶栏 HostChip + 断连 banner
 * (原型 mobile-app-home.html 设计;连接是持续状态,不是一扇门)。
 */
import React from "react";
import {
  configureRemoteEndpoint,
  forceRemoteReconnect,
  isRemotePaused,
  onRemoteRevoked,
  serverCapabilities,
  serverVersion,
} from "@kernel/transport";
import { shellLog } from "@kernel/shellBridge";
import { PairingScreen, ShellPage } from "./PairingScreen";
import { loadCreds, persistCreds, resolveCreds, type MobileCreds } from "./creds";
import { REQUIRED_CAPABILITY, endpointCandidates } from "./shared";
import { MobileApp } from "./MobileApp";


declare global {
  interface Window {
    /** 壳注入脚本打上的移动壳标记。 */
    __TMD_SHELL__?: string;
    /** 壳注入的真实设备名(系统设置里的名字);配对上报桌面区分多机。 */
    __TMD_DEVICE_NAME__?: string;
    /** 壳注入的硬件标识(utsname.machine,如 iPhone17,1);默认名拼它区分多机。 */
    __TMD_DEVICE_MODEL__?: string;
  }
}

type HelloProbe =
  | { kind: "hello"; version: string; caps: string[] }
  | { kind: "pending" }
  | { kind: "rejected" }
  | { kind: "timeout" };

/** 单端点 hello 探测(8s 超时);挂 transport 端点 = 顺带建连。 */
async function probeOne(creds: MobileCreds, wsUrl: string): Promise<HelloProbe> {
  configureRemoteEndpoint({ ...creds, wsUrl });
  const { promise, resolve } = Promise.withResolvers<HelloProbe>();
  let settled = false;
  const done = (o: HelloProbe) => {
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

/** 双通道竞速:按候选序探测,超时换下一端点;pending/rejected 与端点无关,即返。 */
async function helloProbe(creds: MobileCreds): Promise<HelloProbe> {
  for (const url of endpointCandidates(creds)) {
    const o = await probeOne(creds, url);
    if (o.kind !== "timeout" || endpointCandidates(creds).length === 1) return o;
  }
  return { kind: "timeout" };
}

export function MobileRoot() {
  /* 白屏BlackBox:页面级异常/unhandledrejection 同步进 shell.log(真机唯一现场)。
   * 白屏事故排查的最大黑洞就是「JS 炸了但日志零痕迹」——此钩子出生即挂。 */
  React.useEffect(() => {
    const fmt = (r: unknown) => {
      const e = r as { message?: string; stack?: string; reason?: unknown };
      const m = e?.message ?? String(r);
      return `${m.slice(0, 200)} @ ${(e?.stack ?? "").split("\n")[1]?.trim().slice(0, 160)}`;
    };
    const onErr = (ev: ErrorEvent) => shellLog(`window.onerror: ${fmt(ev.error ?? ev.message)}`);
    const onRej = (ev: PromiseRejectionEvent) => shellLog(`unhandledrejection: ${fmt(ev.reason)}`);
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);
    return () => {
      window.removeEventListener("error", onErr);
      window.removeEventListener("unhandledrejection", onRej);
    };
  }, []);

  /* undefined = 凭证解析中;null = 无凭证(配对屏);否则主界面 */
  const [creds, setCreds] = React.useState<MobileCreds | null | undefined>(undefined);
  /* block = hello 能力不满足(一次性探测;协议升级提示屏) */
  const [blocked, setBlocked] = React.useState<string | null>(null);
  const [probeKey, setProbeKey] = React.useState(0);

  React.useEffect(() => {
    void resolveCreds().then((c) => {
      shellLog(
        c
          ? `boot: creds ok host=${c.hostName} endpoints=${(c.urls ?? [c.wsUrl]).length}`
          : "boot: no creds → pairing screen",
      );
      setCreds(c);
    });
  }, []);

  /* iOS 后台掐 WS:回前台/可见即强制重拨(撤销态 no-op)。手动断开态不复活。 */
  React.useEffect(() => {
    const onShow = () => {
      if (!isRemotePaused()) forceRemoteReconnect();
    };
    const onVis = () => {
      if (document.visibilityState === "visible" && !isRemotePaused()) forceRemoteReconnect();
    };
    window.addEventListener("pageshow", onShow);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("pageshow", onShow);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  /* 运行期撤销常驻订阅(评审 B2):清凭证 → 回配对屏。pending 由配对流程自消化;
   * bye+4001 双触发由 persistCreds(null)+reload 幂等吸收。 */
  React.useEffect(() => {
    if (creds === undefined || creds === null) return;
    return onRemoteRevoked((reason) => {
      if (reason === "pending") return;
      void persistCreds(null);
      window.location.reload();
    });
  }, [creds]);

  /* hello 能力探测:block 屏判定(有凭证才有意义)。 */
  React.useEffect(() => {
    if (!creds || blocked !== null) return;
    void helloProbe(creds).then((o) => {
      if (o.kind === "hello" && !o.caps.includes(REQUIRED_CAPABILITY)) {
        setBlocked(o.version);
      }
      // hello 正常 / pending / timeout:主界面自持(HostChip/banner 表达连接态)
    });
  }, [creds, probeKey, blocked]);

  if (creds === undefined) return <div className="m-app" />;
  if (!creds) {
    /* 从连接面板「重新配对」进来时旧凭证仍在(只清了 state):给返回入口,
     * 不想重扫就能切回老连接;冷启动无凭证/撤销清库后 saved=null,不出现。 */
    const saved = loadCreds();
    return (
      <div className="m-app">
        <PairingScreen
          savedHostName={saved?.hostName ?? null}
          onCancel={saved ? () => setCreds(saved) : undefined}
          onPaired={async (c) => {
            await persistCreds(c); // 评审 B4:写成功再进门,杀 app 不丢凭证
            setBlocked(null);
            setCreds(c);
          }}
        />
      </div>
    );
  }
  if (blocked !== null) {
    return (
      <div className="m-app">
        <ShellPage>
          <div style={{ fontSize: 32, color: "var(--warn)" }}>⚠</div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>桌面端协议不兼容</div>
          <div style={{ fontSize: 12.5, opacity: 0.75, lineHeight: 1.8 }}>
            当前桌面 {blocked || "?"},缺 {REQUIRED_CAPABILITY} 能力;
            <br />
            请在桌面端升级 tmd-cli 后重试。
          </div>
          <button
            type="button"
            className="m-btn"
            style={{ maxWidth: 220 }}
            onClick={() => {
              setBlocked(null);
              setProbeKey((k) => k + 1);
            }}
          >
            重新检测
          </button>
          <button
            type="button"
            className="m-fine"
            style={{ background: "none", border: "none", textDecoration: "underline" }}
            onClick={() => {
              void persistCreds(null);
              setCreds(null);
            }}
          >
            重新配对
          </button>
        </ShellPage>
      </div>
    );
  }
  return <ShellErrorBoundary><MobileApp creds={creds} onRePair={() => setCreds(null)} /></ShellErrorBoundary>;
}

/** 主应用错误边界:渲染抛错不再整树白屏,错误原文上屏+进 shell.log。 */
class ShellErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { err: Error | null }
> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) {
    return { err };
  }
  componentDidCatch(err: Error, info: React.ErrorInfo) {
    shellLog(`render crash: ${err.message} | ${String(info.componentStack ?? "").slice(0, 300)}`);
  }
  render() {
    if (this.state.err) {
      return (
        <div className="m-app">
          <ShellPage>
            <div style={{ fontSize: 28, color: "var(--err)" }}>✕</div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>界面渲染出错</div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 11, opacity: 0.8, wordBreak: "break-all", textAlign: "left" }}>
              {this.state.err.message}
            </div>
            <button type="button" className="m-btn" style={{ maxWidth: 220 }} onClick={() => window.location.reload()}>
              重新加载
            </button>
          </ShellPage>
        </div>
      );
    }
    return this.props.children;
  }
}