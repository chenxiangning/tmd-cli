/**
 * 「昨日未完」聚合面板(昨日文章 tab 顶部,晨启动面)—— 会话(跨夜挂起/未查看)
 * 一键续起 + 未勾便签勾选摘除。口径见 unfinished.ts;数据源全现成:
 * 昨日行集(useDaySessions)+ 当月便签快照 + kernel 归档判定/续聊/聚焦。
 * ponytail: 便签聚合范围 = 当月 ≤ 昨日;跨月历史不扫,真需要再开月遍历。
 */
import { useMemo, useState } from "react";
import { t } from "@kernel/i18n";
import { host } from "@kernel/host";
import { isSessionArchived, sessionArchiveKey } from "@kernel/sessionArchive";
import { requestSessionReveal } from "@kernel/sessionReveal";
import type { Workspace } from "@kernel/workspace";
import { saveNote } from "./journalStore";
import type { DayNote } from "./journalFiles";
import { collectUnfinished, type UnfinishedNoteInput, type UnfinishedSessionInput } from "./unfinished";
import { hmOf } from "./timeUtil";
import type { DaySessionRow } from "./daySessions";
import { EngMark } from "./EngMark";

function localDayStart(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function UnfinishedPanel({
  y,
  m,
  rows,
  notes,
  workspaces,
}: {
  y: number;
  m: number;
  /** 昨日行集(活行+盘行;调用方已按日筛)。 */
  rows: DaySessionRow[];
  /** 当月便签 [dd, note](调用方筛 ≤ 昨日)。 */
  notes: readonly (readonly [string, DayNote])[];
  workspaces: Workspace[];
}) {
  const now = Date.now();
  const result = useMemo(() => {
    const sess: UnfinishedSessionInput[] = rows.map((r) => ({
      profileId: r.profileId,
      title: r.title,
      startedAt: r.startedAt,
      lastActive: r.modifiedAt,
      live: r.live,
      archived: r.disk
        ? isSessionArchived(sessionArchiveKey(r.wsId ?? "", r.profileId, r.disk.id))
        : false,
    }));
    const noteIn: UnfinishedNoteInput[] = notes.map(([dd, n]) => ({
      key: dd,
      text: n.text,
      updatedAt: n.updatedAt,
      checked: n.checked,
    }));
    return collectUnfinished(sess, noteIn, { todayStart: localDayStart(now), now });
    // rows/notes 引用随父级快照更新(clock 秒级漂移不影响口径,now 不入依赖)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, notes]);
  const [toggleErr, setToggleErr] = useState(false); /* Hook 顺序:早退(空聚合)前 */
  const total = result.sessions.length + result.notes.length;
  if (total === 0) return null;

  /* 续起:活行 = 聚焦终端;盘行 = openDiskSession 续聊(board/search 同语义)。
   * ws 已删(缓存行)时不 spawn:空 cwd 只会在 app 目录开垃圾会话。 */
  const openSession = (s: (typeof result.sessions)[number]): void => {
    const row = rows.find(
      (r) => r.title === s.title && r.profileId === s.profileId && r.startedAt === s.startedAt,
    );
    if (!row) return;
    if (row.live && row.id) {
      requestSessionReveal(row.id);
      return;
    }
    if (row.disk) {
      const ws = workspaces.find((w) => w.id === row.wsId);
      if (!ws) return;
      void host.openDiskSession(row.profileId, ws.root, ws.id, row.disk.id);
    }
  };
  /* 勾掉便签:翻 checked 原样落盘(text/images/updatedAt 不动,与编辑器同款);
   * 写失败明示(静默失败会让用户以为已摘除,次日聚合照挂)。 */
  const toggleNote = (dd: string): void => {
    const found = notes.find(([d]) => d === dd);
    if (!found) return;
    const [, n] = found;
    setToggleErr(false);
    void saveNote(y, m, Number(dd), n.checked ? { ...n, checked: undefined } : { ...n, checked: true }).catch(
      () => setToggleErr(true),
    );
  };

  return (
    <div className="dj-unfinished">
      <h4>
        {t("昨日未完")} <span className="dj-uf-count">{total}</span>
      </h4>
      {result.sessions.map((s) => (
        <div key={`s-${s.profileId}-${s.startedAt}`} className="dj-uf-row">
          <span className={`dj-uf-kind ${s.kind}`}>{s.kind === "idle" ? t("空闲") : t("未查看")}</span>
          <EngMark id={s.profileId} />
          <span className="dj-uf-title">{s.title}</span>
          <span className="dj-uf-time">{hmOf(s.lastActive)}</span>
          <button type="button" className="dj-uf-act" onClick={() => openSession(s)}>
            {s.kind === "idle" ? t("续") : t("查看")}
          </button>
        </div>
      ))}
      {result.notes.map((n) => (
        <div key={`n-${n.key}`} className="dj-uf-row">
          <span className="dj-uf-kind note">{t("便签")}</span>
          <span className="dj-uf-title">{n.text}</span>
          <span className="dj-uf-time">{n.key}</span>
          <button type="button" className="dj-uf-act" onClick={() => toggleNote(n.key)}>
            {t("勾掉")}
          </button>
        </div>
      ))}
      {toggleErr && <div className="dj-nc-pasteerr">{t("保存失败,请重试")}</div>}
    </div>
  );
}
