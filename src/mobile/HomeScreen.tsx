/**
 * home 屏 —— 会话列表(原型 mobile-app-home.html)。
 * host-bar + 搜索 + 工作区分组行(引擎字形/标题/相对时间/状态点)+ fab;
 * 断连 = banner + 列表快照减淡。数据 = 远程 RPC 轮询(见 MobileApp)。
 */
import React, { useMemo, useState } from "react";
import { SpawnSheet } from "./SpawnSheet";
import { t } from "@kernel/i18n";
import { HostBar } from "./MobileApp";
import { useMobile } from "./shared";
import { glyphOf, relTime, type RemoteSession } from "./remote";

export function HomeScreen() {
  const { sessions, workspaces, titleOf, route, go } = useMobile();
  const [q, setQ] = useState("");
  const [spawn, setSpawn] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  /* 审批线待审数(home 行琥珀点 + pill;白名单 checkpoint_list 只读)。 */
  const [pending, setPending] = useState<Record<string, number>>({});

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

  const groups = useMemo(() => {
    const byWs = new Map<string, RemoteSession[]>();
    for (const s of sessions) {
      if (q && !titleOf(s).toLowerCase().includes(q.toLowerCase())) continue;
      const key = s.workspace_id ?? "default";
      (byWs.get(key) ?? byWs.set(key, []).get(key)!).push(s);
    }
    return [...byWs.entries()]
      .map(([wsId, list]) => ({
        wsId,
        name: workspaces.find((w) => w.id === wsId)?.name ?? wsId,
        list: list.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0)),
      }))
      .sort((a, b) => b.list.length - a.list.length);
  }, [sessions, workspaces, titleOf, q]);

  return (
    <>
      <HostBar />
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
              <span className="cnt">{g.list.length}</span>
            </button>
            {!collapsed[g.wsId] &&
              g.list.map((s) => (
                <SessionRow
                  key={s.id}
                  s={s}
                  title={titleOf(s)}
                  active={route.sessionId === s.id}
                  pending={pending[s.id] ?? 0}
                  onOpen={() => go({ view: "session", sessionId: s.id })}
                />
              ))}
          </React.Fragment>
        ))}
        {sessions.length > 0 && (
          <div style={{ margin: "14px 0 8px", fontSize: 11, color: "var(--fg-subtle)", textAlign: "center" }}>
            {t("已归档会话在桌面端查看")}
          </div>
        )}
      </div>
      <button
        type="button"
        className="fab"
        aria-label={t("发起会话")}
        onClick={() => setSpawn(true)}
      >
        +
      </button>
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

function SessionRow(props: {
  s: RemoteSession;
  title: string;
  active: boolean;
  pending: number;
  onOpen: () => void;
}) {
  const g = glyphOf(props.s.profile_id);
  return (
    <button type="button" className={`row${props.active ? " active" : ""}`} onClick={props.onOpen}>
      <span className={`glyph ${g.cls}`}>{g.text}</span>
      <span className="t">{props.title}</span>
      {props.pending > 0 && (
        <span className="pill">{t("审批 {n}", { n: props.pending })}</span>
      )}
      <span className="meta">{relTime(props.s.created_at)}</span>
      <span className={`sdot${props.pending > 0 ? " ask" : ""}`} />
    </button>
  );
}
