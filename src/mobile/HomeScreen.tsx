/** home 屏:单顶栏+搜索+工作区分组(本地/归档分段);活会话+磁盘历史同列,
 * 断连 = banner + 快照减淡。 */
import React, { useMemo, useState } from "react";
import { SpawnSheet } from "./SpawnSheet";
import { t } from "@kernel/i18n";
import { invoke } from "@kernel/transport";
import { ConnBanner, HostChip } from "./ConnChip";
import { useMobile } from "./shared";
import { Row } from "./Row";
import { groupHomeRows, partitionByArchive, pinKeyOf, scanWorkspaceHistory, topZones, type HistoryItem, type HomeRow } from "./history";

/** 磁盘历史重扫节奏:读头有 mtime 缓存,稳态每轮只剩 fs_collect_files 轻量 RPC。 */
const HISTORY_RESCAN_MS = 60_000;
/** 工作区分段分页:每页行数(分页水位按 工作区:分段 独立)。 */
const PAGE_SIZE = 10;

export function HomeScreen() {
  const { sessions, workspaces, titles, titleOf, route, go, archive, pins, togglePin } = useMobile();
  const [q, setQ] = useState("");
  const [spawn, setSpawn] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  /* 工作区视图分段:本地(默认)/ 归档;分页水位按视图独立(key = 工作区:分段)。 */
  const [wsTab, setWsTab] = useState<Record<string, "local" | "archive">>({});
  const [limits, setLimits] = useState<Record<string, number>>({});
  /* 审批线待审数(home 行琥珀点 + pill;白名单 checkpoint_list 只读)。 */
  const [pending, setPending] = useState<Record<string, number>>({});
  /* 磁盘历史:key = 工作区 root。 */
  const [history, setHistory] = useState<Map<string, HistoryItem[]>>(new Map());

  /* 轮询目标:截断前按 createdAt 稳定排序(源 HashMap 无序,否则徽标覆盖面漂移)。 */
  const targets = useMemo(
    () => [...sessions].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)).slice(0, 12)
      .map((s) => [s.id, s.cwd ?? ""] as [string, string]),
    [sessions],
  );
  React.useEffect(() => {
    let alive = true;
    const pull = async () => {
      if (!targets.length) {
        if (alive) setPending({});
        return;
      }
      const entries = await Promise.all(
        targets.map(async ([id, cwd]) => {
          try {
            const batches = await invoke<{ open: boolean; state: string }[]>(
              "checkpoint_list",
              { cwd, sessionId: id, tmdSessionId: id },
            );
            return [
              id,
              batches.filter((b) => !b.open && b.state === "pending").length,
            ] as const;
          } catch {
            return [id, 0] as const;
          }
        }),
      );
      if (alive) setPending(Object.fromEntries(entries));
    };
    void pull();
    const timer = setInterval(pull, 10_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [targets]);

  /* 磁盘历史扫描:工作区清单变化 / 挂载 / 60s 周期。签名依赖,避免 2.5s 轮询重触发。 */
  /* 直接数组身份(P2-5:裸拼串遇 |/: 错位;MobileApp 签名比对后 set,身份稳定)。 */
  const roots = useMemo(() => workspaces.map((w) => w.root), [workspaces]);
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
    const timer = setInterval(scan, HISTORY_RESCAN_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [roots]);

  const titleOfDisk = React.useCallback(
    (h: HistoryItem) =>
      titles[`${h.profileId}:${h.session.id}`] ?? h.session.title ?? h.session.id.slice(0, 8),
    [titles],
  );

  const groups = useMemo(
    () => groupHomeRows({ workspaces, sessions, history, q, titleOfLive: titleOf, titleOfDisk }),
    [workspaces, sessions, history, q, titleOf, titleOfDisk],
  );
  /* 顶部两区(搜索词在场时同样过滤,与分组区一致)。 */
  const zones = useMemo(() => topZones({ groups, pins }), [groups, pins]);
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
        <div className="zone-head">{head} {rows.length}</div>
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
      <div className="nav">
        <span className="t home-t">tmd-cli</span>
        <button type="button" className="nav-chip" aria-label={t("发起会话")} onClick={() => setSpawn(true)}>
          + {t("新建")}
        </button>
        <HostChip />
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
        {groups.map((g) => {
          const { local, archived } = partitionByArchive(g.rows, g.wsId, archive);
          const tab = wsTab[g.wsId] ?? "local";
          const rows = tab === "local" ? local : archived;
          const key = `${g.wsId}:${tab}`;
          const limit = limits[key] ?? PAGE_SIZE;
          /* 默认折叠;搜索词在场时强制展开(否则搜索结果不可见)。 */
          const open = q.trim() ? true : expanded[g.wsId] === true;
          return (
            <React.Fragment key={g.wsId}>
              <div className="ws-head">
                <button
                  type="button"
                  className="ws-caret"
                  aria-expanded={open}
                  aria-label={open ? t("折叠") : t("展开")}
                  onClick={() => setExpanded((m) => ({ ...m, [g.wsId]: !m[g.wsId] }))}
                >
                  {open ? "▾" : "▸"}
                </button>
                <span className="ws-name">{g.name}</span>
                <div className="ws-seg" role="tablist">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === "local"}
                    className={tab === "local" ? "on" : ""}
                    onClick={() => setWsTab((m) => ({ ...m, [g.wsId]: "local" }))}
                  >
                    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                      <rect x="1.8" y="2.5" width="12.4" height="8.4" rx="1.4" /><path d="M5.5 13.5h5M8 10.9v2.6" strokeLinecap="round" />
                    </svg>
                    {t("本地")} <b>{local.length}</b>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === "archive"}
                    className={tab === "archive" ? "on" : ""}
                    onClick={() => setWsTab((m) => ({ ...m, [g.wsId]: "archive" }))}
                  >
                    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                      <rect x="2" y="4.5" width="12" height="8.6" rx="1.4" /><path d="M2 7.5h12M5.5 4.5 4 7.5" strokeLinecap="round" />
                    </svg>
                    {t("归档")} <b>{archived.length}</b>
                  </button>
                </div>
              </div>
              {open && (
                <>
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
                </>
              )}
            </React.Fragment>
          );
        })}
      </div>
      {spawn && (
        <SpawnSheet
          onClose={() => setSpawn(false)}
          onSpawned={(sessionId) => {
            setSpawn(false);
            go({ view: "session", sessionId });
          }}
        />
      )}
    </>
  );
}
