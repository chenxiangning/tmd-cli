/**
 * 手机主应用:home(会话列表)↔ session(实况/审批/发送)两层路由。
 * 数据 = 会话注册表事件驱动重拉 + 低频兜底 + 活流订阅;连接态由 transport 自愈,
 * 断连 banner 与列表快照按原型 mobile-app-home.html 表达。
 * 手机端**不挂**桌面 host 单例(远程模式它恒空):等待态由 SessionScreen
 * 的活流 ask 检测驱动,ask 首现即弹本地通知(壳态)。
 */
import React from "react";
import type { MobileCreds } from "./creds";
import { checkSessionAsk, collectIdleEdges, MobileAppCtx, endpointKind, type MobileRoute } from "./shared";
import { HomeScreen } from "./HomeScreen";
import { SessionScreen } from "./SessionScreen";
import { HistoryScreen } from "./HistoryScreen";
import { GitScreen } from "./GitScreen";
import type { RemoteSession, RemoteWorkspace } from "./remote";
import { pruneDrafts } from "./useDraft";
import { listSessions, listWorkspaces, overlayState, sessionPinToggle } from "./remote";
import { activeRemoteEndpoint, isRemoteConnected, isRemotePaused, listen, onRemoteConnection } from "@kernel/transport";
import { baseName } from "@kernel/pathUtils";

export function MobileApp(props: { creds: MobileCreds; onRePair: () => void }) {
  const [sessions, setSessions] = React.useState<RemoteSession[]>([]);
  const [workspaces, setWorkspaces] = React.useState<RemoteWorkspace[]>([]);
  /* 首拉成功标记:「未加载」与「确无工作区」分流(SpawnSheet blocked 文案)。 */
  const [wsLoaded, setWsLoaded] = React.useState(false);
  const [titles, setTitles] = React.useState<Record<string, string>>({});
  const [pins, setPins] = React.useState<Record<string, { title?: string; pinnedAt?: number }>>({});
  const [archive, setArchive] = React.useState<Set<string>>(() => new Set());
  const [conn, setConn] = React.useState(() => ({
    connected: isRemoteConnected(),
    paused: isRemotePaused(),
  }));
  React.useEffect(() => onRemoteConnection(setConn), []);
  const [route, setRoute] = React.useState<MobileRoute>({ view: "home" });

  /* 列表同步:事件驱动 + 低频兜底(2026-10-05 列表查询优化 P2)。
     sessions:changed(桌面注册表突变,签名去抖后广播)→ 防抖 300ms 立即拉;
     兜底周期 LAN 15s / WAN 30s(断连窗口丢事件由兜底 + 恢复即拉罩住)。
     签名比对后再 set:无脑 set 新数组 = ctx 重造全树重渲染(评审 P2-8)。 */
  React.useEffect(() => {
    let alive = true;
    let sigS = "";
    let sigW = "";
    const pull = async () => {
      try {
        const [s, w] = await Promise.all([listSessions(), listWorkspaces()]);
        if (!alive) return;
        setWsLoaded(true); /* 桥通即视首拉有效(两令同桥,一败俱败由 catch 兜) */
        const ns = JSON.stringify(s);
        const nw = JSON.stringify(w);
        if (ns !== sigS) { sigS = ns; setSessions(s); }
        if (nw !== sigW) { sigW = nw; setWorkspaces(w); }
      } catch {
        /* 断连:保留快照 */
      }
    };
    void pull();
    let timer = 0;
    let sigEp = ""; /* 端点签名:换桌面连接(同桥不断线)也立即重拉,旧快照窗口收敛到一拍内 */
    const tick = () => {
      const ep = activeRemoteEndpoint();
      const key = ep ? `${endpointKind(ep)}:${ep}` : "none";
      if (key !== sigEp) { sigEp = key; void pull(); }
      timer = window.setTimeout(() => void pull().finally(tick), ep && endpointKind(ep) === "wan" ? 30_000 : 15_000);
    };
    /* 桥恢复即拉:断连窗口丢的 sessions:changed 不等兜底周期(settings 链同款)。 */
    const offConn = onRemoteConnection((c) => {
      if (c.connected) void pull();
    });
    /* 事件防抖:桌面连发(批量活动翻转)只拉一次;首拍竞态无害(签名比对)。 */
    let deb = 0, queued = false;
    const off = listen("sessions:changed", () => {
      if (queued) return;
      queued = true;
      deb = window.setTimeout(() => { queued = false; void pull(); }, 300);
    });
    return () => {
      alive = false;
      clearTimeout(timer);
      clearTimeout(deb);
      offConn();
      void off.then((f) => f()).catch(() => undefined);
    };
  }, []);
  /* 草稿键老化清理(挂载期一次):会话删除后草稿键无人引用,按台账年龄回收 */
  React.useEffect(() => {
    pruneDrafts();
  }, []);

  /* 覆盖层(桌面 settings):手动命名 + 归档键集 + 置顶。桌面任何一侧改动都广播
     settings:changed(桥 event_sink 转发,手机自己的置顶窄令也触发)→ 重拉即同步。
     冷启动竞态(2026-09-23 手机 shell.log 实证):进 app 瞬间桥未连,首拉全失败且
     无重试 → archive 恒空 → 归档磁盘行全被划进「本地」。失败退避重试直到成功,
     与列表轮询同一自愈纪律(onRemoteConnection 只在翻转时触发,罩不住已连场景)。 */
  /* 本地 pin 写水位(评审 F6):请求发出后本机又写过 pin → 响应快照可能早于该写,
     整表覆写会冲掉乐观位;此时只合 titles/archive,pins 留本地(服务端随后广播会再收敛)。 */
  const lastPinWriteAt = React.useRef(0);
  React.useEffect(() => {
    let alive = true;
    let timer = 0;
    const pull = () => {
      clearTimeout(timer);
      const reqAt = Date.now();
      void overlayState().then(
        (o) => {
          if (!alive) return;
          setTitles(o.titles);
          setArchive(o.archive);
          if (lastPinWriteAt.current <= reqAt) setPins(o.pins);
          /* 周期兜底(2026-10-03):settings:changed 是唯一同步源,断连窗口丢事件
             = 命名/归档/置顶无限期滞后;30s 全量重拉封死(轻 RPC,桌面读盘一次)。 */
          timer = window.setTimeout(pull, 30_000);
        },
        () => {
          if (alive) timer = window.setTimeout(pull, 3000);
        },
      );
    };
    pull();
    /* 桥恢复即拉:断连期间错过的 settings:changed 不等 30s 周期。 */
    const offConn = onRemoteConnection((c) => {
      if (c.connected) pull();
    });
    /* 防抖:桌面连发 settings:changed(如批量归档)只拉一次全量。 */
    const off = listen("settings:changed", () => {
      clearTimeout(timer);
      timer = window.setTimeout(pull, 300);
    });
    return () => {
      alive = false;
      clearTimeout(timer);
      offConn();
      void off.then((f) => f()).catch(() => undefined);
    };
  }, []);

  const togglePin = React.useCallback(async (key: string, title: string) => {
    /* 水位打在写之前:在途 pull 的响应快照可能早于本机写(评审 F6)。 */
    lastPinWriteAt.current = Date.now();
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
      `${glyphOf2(s.profileId).text} · ${baseName(s.cwd) || s.cwd}`,
    [titles],
  );

  /* ask 事件化沿检测(2026-10-06,消他屏 60s 轮询延迟):sessions:changed
     (活动翻转驱动重拉)后算 turnActive 下降沿,沿上拉该会话尾页跑 ask 标记
     —— 与 home 轮询共用 askRounds 台账,同一轮天然只通知一次。检出延迟
     60s → 事件级(~1-3s);增量流量 = 每沿一个 8K 尾页(完工/ask 频率,低频)。
     正看的会话跳过(SessionScreen 实况检测更即时);首见无沿可比,冷启动不扫。 */
  const prevTurnActive = React.useRef(new Map<string, boolean>());
  React.useEffect(() => {
    const viewing = route.view === "session" ? route.sessionId : undefined;
    for (const it of collectIdleEdges(prevTurnActive.current, sessions)) {
      if (it.id === viewing) continue;
      void checkSessionAsk(it.id, titleOf(it)).catch(() => undefined);
    }
  }, [sessions, route, titleOf]);

  const ctx = React.useMemo(
    () => ({
      creds: props.creds,
      sessions,
      workspaces,
      wsLoaded,
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
    [props.creds, sessions, workspaces, wsLoaded, titles, archive, pins, conn, route, titleOf, togglePin, props.onRePair],
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
        ) : route.view === "git" ? (
          <GitScreen onBack={() => setRoute({ view: "home" })} />
        ) : route.view === "session" ? (
          <SessionScreen
            key={route.sessionId ?? ""}
            sessionId={route.sessionId ?? ""}
            spawnedAt={route.spawnedAt}
          />
        ) : null}
      </div>
    </MobileAppCtx.Provider>
  );
}


/** glyphOf 的 MobileApp 内部别名(避免与 remote.glyphOf 双导出)。 */
function glyphOf2(profileId: string): { text: string } {
  return { text: String(profileId ?? "").slice(0, 3).toUpperCase() };
}
