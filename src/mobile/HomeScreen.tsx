/** home 屏:单顶栏+搜索+工作区分组(本地/归档分段);活会话+磁盘历史同列,
 * 断连 = banner + 快照减淡。 */
import React, { useMemo, useState } from "react";
import { SpawnSheet } from "./SpawnSheet";
import { t } from "@kernel/i18n";
import { ConnBanner, HostChip } from "./ConnChip";
import { pollHomeWatch, useMobile } from "./shared";
import { Row } from "./Row";
import { ArchiveIcon, FolderIcon, GitIcon, LocalIcon, PlusIcon, RefreshIcon } from "./treeIcons";
import { groupHomeRows, partitionByArchive, pinKeyOf, scanWorkspaceHistory, topZones, type HistoryItem, type HomeRow } from "./history";
import { relTime } from "./remote";

/** 磁盘历史重扫节奏:读头有 mtime 缓存,稳态每轮只剩 fs_collect_files 轻量 RPC。 */
const HISTORY_RESCAN_MS = 60_000;
/** 命名追赶重扫:存在「已绑定磁盘身份但真名未解析」的活行时的加密档。 */
const NAME_CHASE_RESCAN_MS = 5_000;
/** 工作区分段分页:每页行数(分页水位按 工作区:分段 独立)。 */
const PAGE_SIZE = 10;

export function HomeScreen() {
  const { sessions, workspaces, titles, titleOf, route, go, archive, pins, togglePin } = useMobile();
  const [q, setQ] = useState("");
  const [spawn, setSpawn] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  /* 工作区视图分段:本地(默认)/ 归档;分页水位按视图独立(key = 工作区:分段)。 */
  const [wsTab, setWsTab] = useState<Record<string, "local" | "archive">>({});
  const [limits, setLimits] = useState<Record<string, number>>({});
  /* 审批线待审数(home 行琥珀点 + pill;白名单 checkpoint_list 只读)。 */
  const [pending, setPending] = useState<Record<string, number>>({});
  /* 磁盘历史:key = 工作区 root。 */
  const [history, setHistory] = useState<Map<string, HistoryItem[]>>(new Map());
  /* 手动刷新:顶栏钮触发一轮立即轮询(审批/ask + 磁盘历史);busy 态旋转指示。 */
  const [refreshing, setRefreshing] = useState(false), [refreshTick, setRefreshTick] = useState(0);
  const spinRef = React.useRef<HTMLSpanElement | null>(null), spinAnim = React.useRef<Animation | null>(null);
  const refresh = () => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshTick((k) => k + 1);
    spinAnim.current = spinRef.current?.animate(
      [{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }], { duration: 900, iterations: Infinity },
    ) ?? null;
  };

  /* 轮询目标:createdAt 稳定排序截断 12(源 HashMap 无序,否则徽标覆盖面漂移);running = 「运行中」区同律,ask 尾窗只查这些。 */
  const items = useMemo(
    () => [...sessions].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)).slice(0, 12)
      .map((s) => ({ id: s.id, cwd: s.cwd ?? "", title: titleOf(s), running: !!(s.activity?.turnActive || s.activity?.unread) })),
    [sessions, titleOf],
  );
  /* 审批计数 + ask 首现边沿轮询(shared.pollHomeWatch 逐会话串行削峰);防重入防叠波,refreshTick = 手动刷新立即开轮。 */
  React.useEffect(() => {
    let alive = true;
    let busy = false;
    const pull = async () => {
      if (busy) return;
      busy = true;
      const counts = await pollHomeWatch(items, route.sessionId).catch(() => null);
      busy = false;
      if (!alive) return;
      setPending(counts ?? {});
      spinAnim.current?.cancel();
      setRefreshing(false);
    };
    void pull();
    const timer = setInterval(pull, 10_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [items, route.sessionId, refreshTick]);

  /* 磁盘历史扫描:清单变化/挂载/60s 周期;签名依赖 + roots 直接数组身份(签名比对 set,身份稳定)。 */
  const roots = useMemo(() => workspaces.map((w) => w.root), [workspaces]);
  /* 未解析命名活行数(有磁盘身份、无手动名、未扫到):>0 = 重扫压 5s 直至解析(60s→≤5s)。 */
  const unresolved = useMemo(() => {
    const rootOf = new Map(workspaces.map((w) => [w.id, w.root] as const));
    return sessions.filter((s) => {
      if (!s.cliSessionId || titles[`${s.profileId}:${s.cliSessionId}`]) return false;
      const items = history.get(rootOf.get(s.workspaceId ?? "default") ?? "");
      return !(items ?? []).some(
        (h) => `${h.profileId}:${h.session.id}` === `${s.profileId}:${s.cliSessionId}`,
      );
    }).length;
  }, [sessions, titles, history, workspaces]);
  React.useEffect(() => {
    let alive = true;
    /* 逐区串行 + 防重入:全并发 = 工作区×引擎 RPC 风暴(实测一波 7.9MB),
       蜂窝慢链路挤爆中继出站队列被桌面掐流;首轮未扫完时 60s 定时器不得叠波。 */
    let running = false;
    const scan = () => {
      if (running) return; // 上一波未完:跳过,不叠 RPC 波
      running = true;
      // promise 链 = 逐区串行(刻意削峰,勿并发化);单区失败保留旧值留下轮。
      void roots
        .reduce(
          (prev, root) =>
            prev.then(() => {
              if (!alive) return undefined;
              return scanWorkspaceHistory(root)
                .then((items) => {
                  if (alive) setHistory((old) => new Map(old).set(root, items));
                })
                .catch(() => undefined);
            }),
          Promise.resolve(),
        )
        .then(() => {
          running = false;
        });
    };
    void scan();
    const timer = setInterval(scan, unresolved > 0 ? NAME_CHASE_RESCAN_MS : HISTORY_RESCAN_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [roots, refreshTick, unresolved]);

  const titleOfDisk = React.useCallback(
    (h: HistoryItem) =>
      titles[`${h.profileId}:${h.session.id}`] ?? h.session.title ?? h.session.id.slice(0, 8),
    [titles],
  );

  const groups = useMemo(
    () => groupHomeRows({ workspaces, sessions, history, q, overlayTitles: titles, titleOfLive: titleOf, titleOfDisk }),
    [workspaces, sessions, history, q, titles, titleOf, titleOfDisk],
  );
  /* 顶部两区(搜索词在场时同样过滤,与分组区一致)。 */
  const configuredWs = useMemo(() => new Set(workspaces.map((w) => w.id)), [workspaces]);
  const zones = useMemo(() => topZones({ groups, pins, configuredWs }), [groups, pins, configuredWs]);
  const pinnedSet = useMemo(() => new Set(zones.pinned), [zones]);
  /** 行 → 归属工作区 id(顶区行跨组,按 groups 反查)。 */
  const wsIdOf = (r: HomeRow): string | undefined =>
    groups.find((g) => g.rows.includes(r))?.wsId;
  /** 行打开:活 → 实况屏;磁盘 → 历史屏(带续聊三参)。 */
  const openRow = (r: HomeRow): void => {
    if (r.kind === "live") {
      go({ view: "session", sessionId: r.live!.id });
      return;
    }
    const wsId = wsIdOf(r);
    go({
      view: "history",
      history: {
        profileId: r.profileId,
        path: r.disk!.path,
        title: r.title,
        cwd: workspaces.find((w) => w.id === wsId)?.root,
        workspaceId: wsId,
        cliSessionId: r.disk!.id,
      },
    });
  };
  /** 行置顶切换(无稳定磁盘身份 = 不可置顶)。快照只传真标题(桌面 pinSession 同律:
     手动命名 > 磁盘原生标题,兜底形态一律空串,由桌面磁盘解析回填)。 */
  const togglePinOf = (r: HomeRow): void => {
    const wsId = wsIdOf(r);
    const k = wsId ? pinKeyOf(wsId, r) : null;
    if (!k) return;
    const real =
      titles[`${r.profileId}:${r.kind === "live" ? r.live?.cliSessionId : r.disk?.id}`] ??
      (r.kind === "disk" ? r.disk?.title : undefined) ??
      "";
    void togglePin(k, real);
  };
  /** 顶区一块:标题 + 行列表(置顶/运行共用;pin 钮态由 pinnedSet 判)。 */
  const zoneBlock = (head: React.ReactNode, rows: HomeRow[], allPinned: boolean) =>
    rows.length === 0 ? null : (
      <>
        <div className="zone-head">{head} · {rows.length}</div>
        {rows.map((r) => (
          <Row key={r.key} r={r} active={route.sessionId === r.key.slice(5)}
            pending={pending[r.key.slice(5)] ?? 0}
            pinned={allPinned || pinnedSet.has(r)}
            onTogglePin={() => togglePinOf(r)} onOpen={() => openRow(r)} />
        ))}
      </>
    );

  return (
    <>
      <div className="nav2">
        <div className="r1">
          <span className="home-t">{t("当前设备上的工作区和任务")}</span>
          <HostChip />
        </div>
        <div className="r2">
          <span className="sum">{t("{n} 个工作区 · {m} 个任务", { n: workspaces.length, m: groups.reduce((a, g) => a + g.rows.length, 0) })}</span>
          <span className="ibtns">
            <button type="button" className="ibtn" aria-label={t("Git 面板")} onClick={() => go({ view: "git" })}><GitIcon /></button>
            <button type="button" className="ibtn" aria-label={t("发起会话")} onClick={() => setSpawn("")}><PlusIcon /></button>
            <button type="button" className="ibtn" aria-label={t("刷新")} aria-busy={refreshing} onClick={refresh}><span ref={spinRef} className="spin" aria-hidden><RefreshIcon /></span></button>
          </span>
        </div>
      </div>
      <ConnBanner />
      <div className="m-body">
        <div className="search">
          <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
            <circle cx="7" cy="7" r="4.4" /><path d="m10.4 10.4 3.4 3.4" strokeLinecap="round" />
          </svg>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("搜索会话…")}
            aria-label={t("搜索会话")}
          />
        </div>
        {(zones.pinned.length > 0 || zones.running.length > 0) && (
          <div className="top-zones">
            {zoneBlock(<><span className="pin-dot" /> {t("已置顶")}</>, zones.pinned, true)}
            {zoneBlock(<><span className="run-dot" /> {t("运行中")}</>, zones.running, false)}
          </div>
        )}
        {groups.length === 0 && zones.running.length === 0 && (
          <div className="empty">
            {q
              ? t("没有匹配的会话")
              : t("暂无会话\n在桌面端启动会话后,这里会实时出现")}
          </div>
        )}
        {groups.length > 0 && <div className="ws-caption"><FolderIcon size={14} /><span>{t("工作区")}</span></div>}
        {groups.map((g) => {
          const { local, archived } = partitionByArchive(g.rows, g.wsId, archive);
          const tab = wsTab[g.wsId] ?? "local";
          const rows = tab === "local" ? local : archived;
          const key = `${g.wsId}:${tab}`;
          const limit = limits[key] ?? PAGE_SIZE;
          /* 默认折叠;搜索词在场时强制展开(否则搜索结果不可见)。 */
          const open = q.trim() ? true : expanded[g.wsId] === true;
          return (
            <div key={g.wsId} className="ws-card">
              <div className="c-head">
                <FolderIcon open={open} size={16} />
                <button type="button" className="ws-name" aria-expanded={open} onClick={() => setExpanded((m) => ({ ...m, [g.wsId]: !m[g.wsId] }))}>{g.name}</button>
                <button type="button" className="ws-plus" aria-label={t("在此工作区发起会话")} onClick={() => setSpawn(g.wsId)}><PlusIcon size={11} /></button>
              </div>
              <div className="c-mid">
                <span className="c-path">{g.root || "—"}</span>
                <div className="ws-seg" role="tablist">
                  {(["local", "archived"] as const).map((v, i) => (
                    <button key={v} type="button" role="tab" aria-selected={tab === (i ? "archive" : "local")} className={tab === (i ? "archive" : "local") ? "on" : ""} onClick={() => setWsTab((m) => ({ ...m, [g.wsId]: i ? "archive" : "local" }))}>
                      {i ? <ArchiveIcon /> : <LocalIcon />}{i ? t("归档") : t("本地")} <b>{(i ? archived : local).length}</b>
                    </button>
                  ))}
                </div>
              </div>
              {g.latest > 0 && <div className="c-foot">{t("更新于 {when}", { when: relTime(g.latest) })}</div>}
              {open && (
                <div className="ws-kids">
                  {rows.length === 0 && (
                    <div className="empty seg-empty">
                      {tab === "local" ? t("暂无会话") : t("没有归档会话")}
                    </div>
                  )}
                  {rows.slice(0, limit).map((r) => (
                    <Row
                      key={r.key}
                      r={r}
                      active={route.sessionId === r.key.slice(5)}
                      pending={pending[r.key.slice(5)] ?? 0}
                      pinned={(() => {
                        const k = pinKeyOf(g.wsId, r);
                        return !!k && k in pins;
                      })()}
                      onTogglePin={() => togglePinOf(r)}
                      onOpen={() => openRow(r)}
                    />
                  ))}
                  {limit < rows.length && (
                    <button
                      type="button"
                      className="more"
                      onClick={() => setLimits((m) => ({ ...m, [key]: limit + PAGE_SIZE }))}
                    >
                      {t("加载更多({n})", { n: rows.length - limit })}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {spawn !== null && (
        <SpawnSheet
          initialWsId={spawn}
          onClose={() => setSpawn(null)}
          onSpawned={(sessionId) => {
            setSpawn(null);
            go({ view: "session", sessionId, spawnedAt: Date.now() });
          }}
        />
      )}
    </>
  );
}

