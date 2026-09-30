/**
 * 每日文章 tab(详情即文件,不弹窗)—— 某一天的完整详情:标题/状态/会话清单 +
 * 文章本体(总览/分节/未完事项)+ 我的便签(B3 开编辑)。生成会话条 B4 接入。
 */
import { useEffect, useMemo, useState } from "react";
import type { EditorTab } from "@kernel/tabs";
import { t } from "@kernel/i18n";
import { stringHue } from "@kernel/colorHash";
import { host } from "@kernel/host";
import { findWorkspaceOrigin } from "@kernel/workspaceOrigins";
import { useWorkspaces } from "@kernel/workspace";
import { loadMonth, dayMetaOf, deriveDayStatus, useJournalState } from "./journalStore";
import { isRowSummarized, useDaySessions, todayKey, type DaySessionRow } from "./daySessions";
import { pad2 } from "./journalFiles";
import type { ArticleTabPayload } from "./journalTabs";
import { dayTitleOf } from "./dateTitle";
import { holOf, useHolidays } from "./holidays";
import { ArticleBody, BeadStrip, Lightbox } from "./articleBody";
import type { DayNoteImage } from "./journalFiles";
import { NoteEditor } from "./NoteEditor";
import { statusChip } from "./statusText";
import { noteImageUrl } from "./noteAssets";
import { TerminalWindow } from "@phosphor-icons/react";

function StatusHints({ st, sessionCount, lastError }: { st: string; sessionCount: number; lastError?: string }) {
  return (
    <>
      {st === "n" && <div className="dj-art-hint">{t("便签独立于文章存在,写下即是记录。")}</div>}
      {st === "f" && <div className="dj-art-hint dj-err">{lastError}</div>}
      {st === "p" && sessionCount > 0 && (
        <div className="dj-art-hint">{t("{n} 个会话等待提取。", { n: sessionCount })}</div>
      )}
    </>
  );
}


/** 生成会话条:绑定会话在表 = 可打开干涉;已退出 = 只读标识。 */
function GenSessionBar({ sessionId, engine }: { sessionId?: string; engine?: string }) {
  if (!sessionId) return null;
  const live = host.getSessions().some((s) => s.id === sessionId);
  return (
    <div className="dj-gensess">
      <TerminalWindow size={12} />
      <span className="dj-gensess-lab">{t("生成会话")}</span>
      <span className="dj-gensess-sub">
        <EngMark id={engine ?? ""} /> {engine ?? ""} · {sessionId}
      </span>
      {live && (
        <button type="button" className="dj-btn" onClick={() => host.setActiveSession(sessionId)}>
          {t("打开会话(可干涉)")}
        </button>
      )}
      {!live && <span className="dj-chip dj-chip-plain">{t("会话已收尾")}</span>}
    </div>
  );
}

/** 引擎品牌标记:注册面 renderIcon 取 glyph(cli 各插件声明制),未登记回落彩点。 */
function EngMark({ id }: { id: string }) {
  const render = host.getCliProfiles().find((p) => p.id === id)?.renderIcon;
  if (render) return <span className="dj-engmark">{render("0.8125rem")}</span>;
  return <i className="dj-engdot" style={{ background: `hsl(${stringHue(id)} 52% 48%)` }} />;
}

function DaySessions({ rows, summarizedAt }: { rows: DaySessionRow[]; summarizedAt?: number }) {
  if (rows.length === 0) return null;
  return (
    <div className="dj-day-sessions">
      <h4>
        {t("当日会话")}
        {summarizedAt !== undefined && (
          <span className="dj-ds-count">
            {t("已归纳 {n}", { n: rows.filter((r) => isRowSummarized(r, summarizedAt)).length })} ·{" "}
            {t("待归纳 {n}", { n: rows.filter((r) => !isRowSummarized(r, summarizedAt)).length })}
          </span>
        )}
      </h4>
      {rows.map((r) => {
        const done = isRowSummarized(r, summarizedAt);
        return (
          <div key={`${r.profileId}-${r.startedAt}`} className="dj-ds-row">
            <EngMark id={r.profileId} />
            <span className="dj-ds-text">
              {r.profileId} · {r.title}
              {r.live ? ` · ${t("进行中")}` : ""}
            </span>
            <span className="dj-ds-ws">{r.wsName}</span>
            {summarizedAt !== undefined && (
              <span className={`dj-chip ${done ? "" : "dj-chip-p"}`}>{done ? t("已归纳") : t("待归纳")}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ArticleTab({ tab }: { tab: EditorTab }) {
  const p = tab.payload as ArticleTabPayload;
  const state = useJournalState();
  const { list } = useWorkspaces();
  const workspaces = useMemo(
    () => list.filter((w) => !findWorkspaceOrigin(w)?.remoteExec),
    [list],
  );
  const { days: sessions } = useDaySessions(workspaces, 0);
  const { y, m } = p;
  useEffect(() => {
    void loadMonth(y, m);
  }, [y, m, state.ready]);
  const snap = state.months[`${y}-${pad2(m)}`];
  const key = `${y}-${pad2(m)}-${pad2(p.d)}`;
  const rows = sessions ? (sessions.get(key) ?? []) : null;
  const article = snap?.articles[pad2(p.d)] ?? null;
  const note = snap?.notes[pad2(p.d)];
  const meta = dayMetaOf(key);
  const isToday = key === todayKey();
  const st = deriveDayStatus(article, isToday, rows?.length ?? 0, meta);
  const [lightbox, setLightbox] = useState<DayNoteImage | null>(null);
  useHolidays();
  /* 便签编辑重入信号:mount 时 autoEdit 起始,同 tab 深链 refresh(payload 换引用)
     再跳变 —— 取消后再点同空日也能重新进入编辑态。 */
  const [editSignal, setEditSignal] = useState(() => (p.autoEdit ? 1 : 0));
  useEffect(() => {
    if ((tab.payload as ArticleTabPayload).autoEdit) setEditSignal((v) => v + 1);
  }, [tab.payload]);
  if (!snap || !rows) return <div className="dj-article dj-article-loading">{t("正在加载…")}</div>;
  return (
    <div className="dj-article">
      <div className="dj-art-bar">
        <span className="dj-art-date">{dayTitleOf(y, m, p.d)}</span>
        {holOf(y, m, p.d) && <span className="dj-holmini">休·{holOf(y, m, p.d)}</span>}
        <span className={`dj-chip dj-chip-${st === "n" ? "plain" : st}`}>{statusChip(st)}</span>
        <span className="dj-art-sub">
          {[...new Set(rows.map((r) => r.profileId))].join(" / ")}
          {rows.length ? ` · ${t("{n} 会话", { n: rows.length })}` : ""}
        </span>
      </div>
      <div className="dj-art-scroll">
        <div className="dj-art-page">
          <h1 className="dj-art-title">{article?.title || t("这一天没有 AI 会话")}</h1>
          <GenSessionBar sessionId={meta.sessionId} engine={meta.engine} />
          <StatusHints st={st} sessionCount={rows.length} lastError={meta.lastError} />
          <NoteEditor key={editSignal} y={y} m={m} d={p.d} note={note} signal={editSignal} onImageOpen={setLightbox} />
          {article && <ArticleBody article={article} />}
          <DaySessions rows={rows} summarizedAt={meta.summarizedAt} />
          <BeadStrip beads={meta.beads} />
          {lightbox && noteImageUrl(lightbox.file) && (
            <Lightbox url={noteImageUrl(lightbox.file)} name={lightbox.name} onClose={() => setLightbox(null)} />
          )}
        </div>
      </div>
    </div>
  );
}
