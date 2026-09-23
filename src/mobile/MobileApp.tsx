/**
 * 手机主应用:home(会话列表)↔ session(实况/审批/发送)两层路由。
 * 数据 = 远程 RPC 轮询(列表 2.5s)+ 活流订阅;连接态由 transport 自愈,
 * 断连 banner 与列表快照按原型 mobile-app-home.html 表达。
 * 手机端**不挂**桌面 host 单例(远程模式它恒空):等待态由 SessionScreen
 * 的活流 ask 检测驱动,ask 首现即弹本地通知(壳态)。
 */
import React from "react";
import type { MobileCreds } from "./creds";
import { MobileAppCtx, type MobileRoute } from "./shared";
import { HomeScreen } from "./HomeScreen";
import { SessionScreen } from "./SessionScreen";
import { HistoryScreen } from "./HistoryScreen";
import type { RemoteSession, RemoteWorkspace } from "./remote";
import { listSessions, listWorkspaces, sessionArchiveKeys, sessionTitles } from "./remote";
import { isRemoteConnected, onRemoteConnection } from "@kernel/transport";

export function MobileApp(props: { creds: MobileCreds; onRePair: () => void }) {
  const [sessions, setSessions] = React.useState<RemoteSession[]>([]);
  const [workspaces, setWorkspaces] = React.useState<RemoteWorkspace[]>([]);
  const [titles, setTitles] = React.useState<Record<string, string>>({});
  const [archive, setArchive] = React.useState<Set<string>>(() => new Set());
  const [connected, setConnected] = React.useState(() => isRemoteConnected());
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

  /* 覆盖层(桌面 settings):手动命名 + 归档键集;进 app 读一次。 */
  React.useEffect(() => {
    void sessionTitles().then(setTitles);
    void sessionArchiveKeys().then(setArchive);
  }, []);

  const titleOf = React.useCallback(
    (s: RemoteSession) =>
      titles[s.id] ?? `${glyphOf2(s.profileId).text} · ${s.cwd.split("/").filter(Boolean).pop() ?? s.cwd}`,
    [titles],
  );

  const ctx = React.useMemo(
    () => ({
      creds: props.creds,
      sessions,
      workspaces,
      titles,
      archive,
      connected,
      route,
      go: setRoute,
      titleOf,
      onRePair: props.onRePair,
    }),
    [props.creds, sessions, workspaces, titles, archive, connected, route, titleOf, props.onRePair],
  );

  return (
    <MobileAppCtx.Provider value={ctx}>
      <div className="m-app">
        {route.view === "home" ? (
          <HomeScreen />
        ) : route.view === "history" ? (
          <HistoryScreen
            key={route.history?.path ?? ""}
            profileId={route.history?.profileId ?? ""}
            path={route.history?.path ?? ""}
            title={route.history?.title ?? ""}
            cwd={route.history?.cwd}
            workspaceId={route.history?.workspaceId}
            cliSessionId={route.history?.cliSessionId}
          />
        ) : (
          <SessionScreen key={route.sessionId ?? ""} sessionId={route.sessionId ?? ""} />
        )}
      </div>
    </MobileAppCtx.Provider>
  );
}


/** glyphOf 的 MobileApp 内部别名(避免与 remote.glyphOf 双导出)。 */
function glyphOf2(profileId: string): { text: string } {
  return { text: String(profileId ?? "").slice(0, 3).toUpperCase() };
}
