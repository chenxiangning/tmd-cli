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
import { listSessions, listWorkspaces, sessionArchiveKeys, sessionPinEntries, sessionPinToggle, sessionTitles } from "./remote";
import { isRemoteConnected, isRemotePaused, listen, onRemoteConnection } from "@kernel/transport";

export function MobileApp(props: { creds: MobileCreds; onRePair: () => void }) {
  const [sessions, setSessions] = React.useState<RemoteSession[]>([]);
  const [workspaces, setWorkspaces] = React.useState<RemoteWorkspace[]>([]);
  const [titles, setTitles] = React.useState<Record<string, string>>({});
  const [pins, setPins] = React.useState<Record<string, { title?: string; pinnedAt?: number }>>({});
  const [archive, setArchive] = React.useState<Set<string>>(() => new Set());
  const [conn, setConn] = React.useState(() => ({
    connected: isRemoteConnected(),
    paused: isRemotePaused(),
  }));
  React.useEffect(() => onRemoteConnection(setConn), []);
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

  /* 覆盖层(桌面 settings):手动命名 + 归档键集 + 置顶。桌面任何一侧改动都广播
     settings:changed(桥 event_sink 转发,手机自己的置顶窄令也触发)→ 重拉即同步。
     冷启动竞态(2026-09-23 手机 shell.log 实证):进 app 瞬间桥未连,首拉全失败且
     无重试 → archive 恒空 → 归档磁盘行全被划进「本地」。失败退避重试直到成功,
     与列表轮询同一自愈纪律(onRemoteConnection 只在翻转时触发,罩不住已连场景)。 */
  React.useEffect(() => {
    let alive = true;
    let timer = 0;
    const pull = () => {
      clearTimeout(timer);
      void Promise.allSettled([sessionTitles(), sessionArchiveKeys(), sessionPinEntries()]).then(
        ([t, a, p]) => {
          if (!alive) return;
          if (t.status === "fulfilled") setTitles(t.value);
          if (a.status === "fulfilled") setArchive(a.value);
          if (p.status === "fulfilled") setPins(p.value);
          if ([t, a, p].some((r) => r.status === "rejected")) timer = window.setTimeout(pull, 3000);
        },
      );
    };
    pull();
    const off = listen("settings:changed", pull);
    return () => {
      alive = false;
      clearTimeout(timer);
      void off.then((f) => f()).catch(() => undefined);
    };
  }, []);

  const togglePin = React.useCallback(async (key: string, title: string) => {
    try {
      const pinned = await sessionPinToggle(key, title);
      setPins((m) => {
        const next = { ...m };
        if (pinned) next[key] = { title, pinnedAt: Date.now() };
        else delete next[key];
        return next;
      });
    } catch {
      /* 桥断:不动本地态 */
    }
  }, []);

  const titleOf = React.useCallback(
    (s: RemoteSession) =>
      /* 桌面命名覆盖层 key = profileId:cliSessionId(桥 resume 直填/绑定镜像后可解析);
         未绑定活会话(新起 CLI 未落盘)= 兜底形态 */
      (s.cliSessionId ? titles[`${s.profileId}:${s.cliSessionId}`] : undefined) ??
      `${glyphOf2(s.profileId).text} · ${s.cwd.split("/").filter(Boolean).pop() ?? s.cwd}`,
    [titles],
  );

  const ctx = React.useMemo(
    () => ({
      creds: props.creds,
      sessions,
      workspaces,
      titles,
      archive,
      pins,
      connected: conn.connected,
      paused: conn.paused,
      route,
      go: setRoute,
      titleOf,
      togglePin,
      onRePair: props.onRePair,
    }),
    [props.creds, sessions, workspaces, titles, archive, pins, conn, route, titleOf, togglePin, props.onRePair],
  );

  return (
    <MobileAppCtx.Provider value={ctx}>
      <div className="m-app">
        {/* home 常驻挂载(进详情只隐藏):返回时保留磁盘历史扫描/折叠/分页/
            滚动位置,免整屏重拉造成的空档期。 */}
        <div className={route.view === "home" ? "m-screen" : "m-screen hide"}>
          <HomeScreen />
        </div>
        {route.view === "history" ? (
          <HistoryScreen
            key={route.history?.path ?? ""}
            profileId={route.history?.profileId ?? ""}
            path={route.history?.path ?? ""}
            title={route.history?.title ?? ""}
            cwd={route.history?.cwd}
            workspaceId={route.history?.workspaceId}
            cliSessionId={route.history?.cliSessionId}
          />
        ) : route.view === "session" ? (
          <SessionScreen key={route.sessionId ?? ""} sessionId={route.sessionId ?? ""} />
        ) : null}
      </div>
    </MobileAppCtx.Provider>
  );
}


/** glyphOf 的 MobileApp 内部别名(避免与 remote.glyphOf 双导出)。 */
function glyphOf2(profileId: string): { text: string } {
  return { text: String(profileId ?? "").slice(0, 3).toUpperCase() };
}
