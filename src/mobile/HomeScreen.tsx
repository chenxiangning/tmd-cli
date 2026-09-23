/**
 * home 屏 —— 单顶栏(主机芯片 + 标题 + 新建)+ 搜索 + 工作区分组行
 * (引擎字形/标题/相对时间/状态点);活会话(session_list)+ 磁盘历史
 * (history.ts 扫描,与桌面侧栏同源适配器)同列;断连 = banner + 列表快照减淡。
 * (原型 mobile-app-home.html;顶栏合并见 spec 2026-09-23-mobile-session-compact。)
 */
import React, { useMemo, useState } from "react";
import { SpawnSheet } from "./SpawnSheet";
import { t } from "@kernel/i18n";
import { ConnBanner, HostChip } from "./ConnChip";
import { useMobile } from "./shared";
import { relTime } from "./remote";
import { EngineMark } from "./EngineMark";
import { groupHomeRows, splitEngineGroups, scanWorkspaceHistory, type HistoryItem, type HomeRow } from "./history";

/** 磁盘历史重扫节奏:读头有 mtime 缓存,稳态每轮只剩 fs_collect_files 轻量 RPC。 */
const HISTORY_RESCAN_MS = 60_000;
/** 引擎子分组分页:每页行数(与桌面侧栏 PAGE_INITIAL 同口径)。 */
const PAGE_SIZE = 10;

export function HomeScreen() {
  const { sessions, workspaces, titles, titleOf, route, go } = useMobile();
  const [q, setQ] = useState("");
  const [spawn, setSpawn] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  /* 引擎子分组分页水位:key = 工作区:引擎。 */
  const [limits, setLimits] = useState<Record<string, number>>({});
  /* 审批线待审数(home 行琥珀点 + pill;白名单 checkpoint_list 只读)。 */
  const [pending, setPending] = useState<Record<string, number>>({});
  /* 磁盘历史:key = 工作区 root。 */
  const [history, setHistory] = useState<Map<string, HistoryItem[]>>(new Map());

  /* 轮询签名:会话集合不变就不重启 interval(sessions 数组每 2.5s 换新引用)。 */
  const pollSig = useMemo(
    () => sessions.slice(0, 12).map((s) => `${s.id}@${s.cwd}`).join("|"),
    [sessions],
  );
  React.useEffect(() => {
    let alive = true;
    const targets = pollSig ? pollSig.split("|").map((pair) => pair.split("@")) : [];
    const pull = async () => {
      if (!targets.length) {
        if (alive) setPending({});
        return;
      }
      // 动态 import:transport 切出主 chunk(手机入口体积),与 remote.ts invokeSafe 同策略
      const { invoke } = await import("@kernel/transport");
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
  }, [pollSig]);

  /* 磁盘历史扫描:工作区清单变化 / 挂载 / 60s 周期。签名依赖,避免 2.5s 轮询重触发。 */
  const wsSig = useMemo(() => workspaces.map((w) => `${w.id}:${w.root}`).join("|"), [workspaces]);
  React.useEffect(() => {
    let alive = true;
    const roots = wsSig ? wsSig.split("|").map((pair) => pair.slice(pair.indexOf(":") + 1)) : [];
    const scan = () => {
      void Promise.all(
        roots.map(async (root) => [root, await scanWorkspaceHistory(root)] as const),
      ).then((entries) => {
        if (alive) setHistory(new Map(entries));
      });
    };
    scan();
    const timer = setInterval(scan, HISTORY_RESCAN_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [wsSig]);

  const titleOfDisk = React.useCallback(
    (h: HistoryItem) =>
      titles[`${h.profileId}:${h.session.id}`] ?? h.session.title ?? h.session.id.slice(0, 8),
    [titles],
  );

  const groups = useMemo(
    () => groupHomeRows({ workspaces, sessions, history, q, titleOfLive: titleOf, titleOfDisk }),
    [workspaces, sessions, history, q, titleOf, titleOfDisk],
  );

  const total = groups.reduce((n, g) => n + g.rows.length, 0);
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
          <span>🔍</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("搜索会话…")}
            aria-label={t("搜索会话")}
          />
        </div>
        {groups.length === 0 && (
          <div className="empty">
            {q
              ? t("没有匹配的会话")
              : t("暂无会话\n在桌面端启动会话后,这里会实时出现")}
          </div>
        )}
        {groups.map((g) => (
          <React.Fragment key={g.wsId}>
            <button
              type="button"
              className="ws-head"
              aria-expanded={!collapsed[g.wsId]}
              onClick={() => setCollapsed((m) => ({ ...m, [g.wsId]: !m[g.wsId] }))}
            >
              <span className="caret">{collapsed[g.wsId] ? "▸" : "▾"}</span>
              {g.name}
              <span className="cnt">{g.rows.length}</span>
            </button>
            {!collapsed[g.wsId] &&
              splitEngineGroups(g.rows).map((eg) => {
                const key = `${g.wsId}:${eg.profileId}`;
                const limit = limits[key] ?? PAGE_SIZE;
                return (
                  <React.Fragment key={key}>
                    <div className="engine-head">
                      <EngineMark profileId={eg.profileId} />
                      <span className="engine-name">{eg.profileId}</span>
                      <span className="cnt">{eg.rows.length}</span>
                    </div>
                    {eg.rows.slice(0, limit).map((r) => (
                      <Row
                        key={r.key}
                        r={r}
                        active={route.sessionId === r.key.slice(5)}
                        pending={pending[r.key.slice(5)] ?? 0}
                        onOpen={() =>
                          r.kind === "live"
                            ? go({ view: "session", sessionId: r.live!.id })
                            : go({
                                view: "history",
                                history: {
                                  profileId: r.profileId,
                                  path: r.disk!.path,
                                  title: r.title,
                                },
                              })
                        }
                      />
                    ))}
                    {limit < eg.rows.length && (
                      <button
                        type="button"
                        className="more"
                        onClick={() =>
                          setLimits((m) => ({ ...m, [key]: limit + PAGE_SIZE }))
                        }
                      >
                        {t("加载更多({n})", { n: eg.rows.length - limit })}
                      </button>
                    )}
                  </React.Fragment>
                );
              })}
          </React.Fragment>
        ))}
        {total > 0 && (
          <div style={{ margin: "14px 0 8px", fontSize: 11, color: "var(--fg-subtle)", textAlign: "center" }}>
            {t("已归档会话在桌面端查看")}
          </div>
        )}
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

/** 会话行(活/磁盘同形):引擎字形 + 标题 + 审批 pill + 相对时间 + 状态点。 */
function Row(props: { r: HomeRow; active: boolean; pending: number; onOpen: () => void }) {
  const live = props.r.kind === "live";
  return (
    <button type="button" className={`row${props.active ? " active" : ""}`} onClick={props.onOpen}>
      <EngineMark profileId={props.r.profileId} />
      <span className="t">{props.r.title}</span>
      {live && props.pending > 0 && (
        <span className="pill">{t("审批 {n}", { n: props.pending })}</span>
      )}
      <span className="meta">{relTime(props.r.ts)}</span>
      <span className={`sdot${live && props.pending > 0 ? " ask" : ""}`} />
    </button>
  );
}
