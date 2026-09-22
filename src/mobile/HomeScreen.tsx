/**
 * home 屏 —— 会话列表(原型 mobile-app-home.html)。
 * host-bar + 搜索 + 工作区分组行(引擎字形/标题/相对时间/状态点)+ fab;
 * 断连 = banner + 列表快照减淡。数据 = 远程 RPC 轮询(见 MobileApp)。
 */
import React, { useMemo, useState } from "react";
import { t } from "@kernel/i18n";
import { HostBar } from "./MobileApp";
import { useMobile } from "./shared";
import { glyphOf, relTime, type RemoteSession } from "./remote";

export function HomeScreen() {
  const { sessions, workspaces, titleOf, route, go } = useMobile();
  const [q, setQ] = useState("");
  const [fabNote, setFabNote] = useState(false);

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
            <div className="ws-head">
              <span className="caret">▾</span>
              {g.name}
              <span className="cnt">{g.list.length}</span>
            </div>
            {g.list.map((s) => (
              <SessionRow key={s.id} s={s} title={titleOf(s)} active={route.sessionId === s.id} onOpen={() => go({ view: "session", sessionId: s.id })} />
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
        aria-label={t("新建会话")}
        onClick={() => {
          setFabNote(true);
          setTimeout(() => setFabNote(false), 2400);
        }}
      >
        +
      </button>
      {fabNote && <div className="fab-note">{t("新建会话请在桌面端进行;手机端提供远程查看与操作")}</div>}
    </>
  );
}

function SessionRow(props: { s: RemoteSession; title: string; active: boolean; onOpen: () => void }) {
  const g = glyphOf(props.s.profile_id);
  return (
    <button type="button" className={`row${props.active ? " active" : ""}`} onClick={props.onOpen}>
      <span className={`glyph ${g.cls}`}>{g.text}</span>
      <span className="t">{props.title}</span>
      <span className="meta">{relTime(props.s.created_at)}</span>
      <span className="sdot" />
    </button>
  );
}
