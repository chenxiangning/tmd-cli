/**
 * 手机主应用:home(会话列表)↔ session(实况/审批/发送)两层路由。
 * 数据 = 远程 RPC 轮询(列表 2.5s)+ 活流订阅;连接态由 transport 自愈,
 * 断连 banner 与列表快照按原型 mobile-app-home.html 表达。
 * 手机端**不挂**桌面 host 单例(远程模式它恒空):等待态由 SessionScreen
 * 的活流 ask 检测驱动,ask 首现即弹本地通知(壳态)。
 */
import React, { useState } from "react";
import { t } from "@kernel/i18n";
import type { MobileCreds } from "./creds";
import { currentEndpoint, MobileAppCtx, useMobile, type MobileRoute } from "./shared";
import { HomeScreen } from "./HomeScreen";
import { SessionScreen } from "./SessionScreen";
import type { RemoteSession, RemoteWorkspace } from "./remote";
import { listSessions, listWorkspaces, sessionTitles } from "./remote";
import { forceRemoteReconnect, onRemoteConnection } from "@kernel/transport";

export interface MobileCtxValue {
  creds: MobileCreds;
  sessions: RemoteSession[];
  workspaces: RemoteWorkspace[];
  titles: Record<string, string>;
  connected: boolean;
  route: MobileRoute;
  go: (r: MobileRoute) => void;
  /** 会话标题解析(覆盖层 → profile 字形回落)。 */
  titleOf: (s: RemoteSession) => string;
}



export function MobileApp(props: { creds: MobileCreds; onRePair: () => void }) {
  const [sessions, setSessions] = React.useState<RemoteSession[]>([]);
  const [workspaces, setWorkspaces] = React.useState<RemoteWorkspace[]>([]);
  const [titles, setTitles] = React.useState<Record<string, string>>({});
  const [connected, setConnected] = React.useState(false);
  React.useEffect(() => onRemoteConnection(setConnected), []);
  const [route, setRoute] = React.useState<MobileRoute>({ view: "home" });

  /* 列表轮询:桥自愈重连,拉取失败保留快照(原型断连态「列表为最近快照」)。 */
  React.useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const [s, w] = await Promise.all([listSessions(), listWorkspaces()]);
        if (!alive) return;
        setSessions(s);
        setWorkspaces(w);
      } catch {
        /* 断连:保留快照 */
      }
    };
    void pull();
    const timer = setInterval(pull, 2500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  /* 手动命名覆盖层(桌面 settings.sessionTitles,key = 会话 id);进 app 读一次。 */
  React.useEffect(() => {
    void sessionTitles().then(setTitles);
  }, []);

  const titleOf = React.useCallback(
    (s: RemoteSession) =>
      titles[s.id] ?? `${glyphOf2(s.profile_id).text} · ${s.cwd.split("/").filter(Boolean).pop() ?? s.cwd}`,
    [titles],
  );

  const ctx = React.useMemo(
    () => ({
      creds: props.creds,
      sessions,
      workspaces,
      titles,
      connected,
      route,
      go: setRoute,
      titleOf,
      onRePair: props.onRePair,
    }),
    [props.creds, sessions, workspaces, titles, connected, route, titleOf, props.onRePair],
  );

  return (
    <MobileAppCtx.Provider value={ctx}>
      <div className="m-app">
        {route.view === "home" ? <HomeScreen /> : <SessionScreen sessionId={route.sessionId ?? ""} />}
      </div>
    </MobileAppCtx.Provider>
  );
}

/** host-bar + 断连 banner(两屏共用;连接态由 transport 事件驱动)。 */
export function HostBar() {
  const { creds, connected, onRePair } = useMobile();
  const endpoint = currentEndpoint(creds);
  const [menu, setMenu] = useState(false);
  return (
    <>
      <div className="host-bar">
        <span className={connected ? "dot" : "dot err"} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="nm">{creds.hostName}</div>
          <div className="sub2">{connected ? stripScheme(endpoint) : t("重连中…")}</div>
        </div>
        <button
          type="button"
          aria-label={t("连接选项")}
          style={{ color: "var(--accent)", fontSize: 13 }}
          onClick={() => setMenu((v: boolean) => !v)}
        >
          ⇄
        </button>
      </div>
      {!connected && (
        <div className="banner">
          <span className="dot" />
          {t("连接已断开 · 正在重连")}
          <button
            type="button"
            onClick={() => {
              forceRemoteReconnect();
            }}
          >
            {t("重试")}
          </button>
        </div>
      )}
      {menu && (
        <div className="menu-sheet" role="menu">
          <button type="button" aria-label={t("关闭菜单")} className="menu-item" style={{ display: "none" }} onClick={() => setMenu(false)} />
          <button
            type="button"
            className="menu-item"
            onClick={() => {
              forceRemoteReconnect();
              setMenu(false);
            }}
          >
            {t("重试连接")}
          </button>
          <button
            type="button"
            className="menu-item danger"
            onClick={() => {
              setMenu(false);
              onRePair();
            }}
          >
            {t("重新配对(扫码)")}
          </button>
        </div>
      )}
    </>
  );
}

function stripScheme(s: string): string {
  return s.replace(/^wss?:\/\//, "");
}


/** glyphOf 的 MobileApp 内部别名(避免与 remote.glyphOf 双导出)。 */
function glyphOf2(profileId: string): { text: string } {
  return { text: profileId.slice(0, 3).toUpperCase() };
}
