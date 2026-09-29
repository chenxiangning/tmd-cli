/**
 * 轴视图 —— 迷你月条(日格快跳)+ 脊柱叙事流:有记录的日子出日卡(脊柱节点 +
 * 生长珠子 + 折叠文章卡 + 只读便签),间隔空白日画 gap(原型 .flow/.day/.spine)。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { PencilSimpleLine } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { dayMetaOf, deriveDayStatus, loadMonth, useJournalState, type MonthSnapshot } from "./journalStore";
import type { DaySessionRow } from "./daySessions";
import { openArticleTab } from "./journalTabs";
import { pad2 } from "./journalFiles";
import { ArticleBody, NoteReadonly } from "./articleBody";
import { notePeekOf, statusChip } from "./statusText";
import { holOf, useHolidays } from "./holidays";
import type { Article } from "./articleParse";
import type { DayNote } from "./journalFiles";
import { dayTitleOf } from "./dateTitle";

interface FlowDay {
  d: number;
  key: string;
  rows: DaySessionRow[];
  article: Article | null;
  note: DayNote | undefined;
}

/** 轴卡节点样式(纯函数)。 */
function nodeClsOf(st: string, hasNote: boolean, hol: boolean): string {
  if (hol) return "dj-node-hol";
  if (st === "t") return "dj-node-t";
  if (st === "p") return "dj-node-p";
  if (st === "f") return "dj-node-f";
  if (st === "g") return "";
  return hasNote ? "dj-node-nn" : "dj-node-n";
}

/** 轴卡正文(文章体/失败/待提取/纯便签语义行;纯函数)。 */
function cardBody(day: { article: Article | null; note: DayNote | undefined; rows: DaySessionRow[] }, st: string, lastError?: string): React.ReactNode {
  if (day.article) return <ArticleBody article={day.article} />;
  if (st === "f") return <div className="dj-fcard-hint dj-err">{lastError}</div>;
  if (st === "p") return <div className="dj-fcard-hint">{t("{n} 个会话等待提取。", { n: day.rows.length })}</div>;
  return <div className="dj-fcard-hint">{t("便签独立于文章存在,写下即是记录。")}</div>;
}

function DayCard({ ym, day, today }: { ym: { y: number; m: number }; day: FlowDay; today: boolean }) {
  const meta = dayMetaOf(day.key);
  const st = deriveDayStatus(day.article, today, day.rows.length, meta);
  const [folded, setFolded] = useState(!today && !day.note);
  const toggle = () => setFolded((v) => !v);
  const notePeek = notePeekOf(day.note);
  return (
    <div className="dj-day">
      <div className="dj-spine">
        <span className={`dj-node ${nodeClsOf(st, !!day.note, !!holOf(ym.y, ym.m, day.d))}`}>{day.d}</span>
        {meta.beads.length > 0 && (
          <div className="dj-beads">
            {meta.beads.map((b, i) => (
              <span key={`${b.t}-${i}`} className="dj-bead" title={`${b.t} · ${b.label}`} />
            ))}
          </div>
        )}
      </div>
      <div className={`dj-fcard ${today ? "dj-fcard-today" : ""} ${folded ? "dj-folded" : ""}`} data-day={day.d}>
        <div className="dj-fcard-head">
          <button
            className="dj-fcard-toggle"
            aria-expanded={!folded}
            aria-label={dayTitleOf(ym.y, ym.m, day.d)}
            onClick={toggle}
          >
            <span className="dj-fcard-date">{dayTitleOf(ym.y, ym.m, day.d)}</span>
            <span className="dj-foldmark">▾</span>
          </button>
          {holOf(ym.y, ym.m, day.d) && <span className="dj-holmini">休·{holOf(ym.y, ym.m, day.d)}</span>}
          <span className={`dj-chip dj-chip-${st === "n" ? "plain" : st}`}>{statusChip(st)}</span>
          {day.article && <span className="dj-fcard-headline">{day.article.title}</span>}
          {folded && notePeek && (
            <span className="dj-fcard-notepeek">
              <PencilSimpleLine size={9} /> {notePeek}
            </span>
          )}
          <button
            className="dj-fullbtn"
            onClick={() => openArticleTab(ym.y, ym.m, day.d, day.article?.title)}
          >
            {t("全文 ↗")}
          </button>
        </div>
        {!folded && (
          <div className="dj-fcard-body">
            {cardBody(day, st, meta.lastError)}
            {day.article && (
              <div className="dj-fcard-foot">
                {meta.beads.length} {t("次落盘")}
              </div>
            )}
            {day.note && <NoteReadonly note={day.note} />}
          </div>
        )}
      </div>
    </div>
  );
}

export function FlowView({
  ym,
  snap,
  sessions,
  today,
}: {
  ym: { y: number; m: number };
  snap: MonthSnapshot;
  sessions: Map<string, DaySessionRow[]>;
  today: string;
}) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    void loadMonth(ym.y, ym.m);
  }, [ym, snap]);
  const prefix = `${ym.y}-${pad2(ym.m)}`;
  const days = new Date(ym.y, ym.m, 0).getDate();
  const metaV = useJournalState().meta;
  useHolidays();
  const flowDays = useMemo<FlowDay[]>(() => {
    const out: FlowDay[] = [];
    for (let d = 1; d <= days; d++) {
      const dd = pad2(d);
      const key = `${prefix}-${dd}`;
      const rows = sessions.get(key) ?? [];
      const article = snap.articles[dd] ?? null;
      const note = snap.notes[dd];
      if (!article && !note && rows.length === 0 && !dayMetaOf(key).lastError) continue;
      out.push({ d, key, rows, article, note });
    }
    return out.reverse();
  }, [days, prefix, sessions, snap, metaV]);
  /** 条格点击:有卡跳转卡,空日开该日文章 tab(与月格空日一致)。 */
  const jump = (d: number) => {
    const root = stripRef.current?.closest(".dj-flow-root") ?? stripRef.current?.closest(".dj-stage");
    const el = root?.querySelector(`[data-day="${d}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("dj-flash");
      setTimeout(() => el.classList.remove("dj-flash"), 1200);
    } else {
      openArticleTab(ym.y, ym.m, d);
    }
  };
  let prevD: number | null = null;
  return (
    <div className="dj-flow-root">
      <div className="dj-minibar">
        <span className="dj-minibar-title">{`${ym.y}-${pad2(ym.m)}`}</span>
        <div className="dj-mb-strip" ref={stripRef}>
          {Array.from({ length: days }, (_, i) => i + 1).map((d) => {
            const fd = flowDays.find((x) => x.d === d);
            const meta = fd ? dayMetaOf(fd.key) : { beads: [], updatedAt: 0 };
            const st = fd ? deriveDayStatus(fd.article, fd.key === today, fd.rows.length, meta) : "n";
            const we = [0, 6].includes(new Date(ym.y, ym.m - 1, d).getDay());
            const cls = [
              holOf(ym.y, ym.m, d)
                ? "dj-mb-hol"
                : st === "t"
                  ? "dj-mb-t"
                  : st === "p"
                    ? "dj-mb-p"
                    : st === "f"
                      ? "dj-mb-f"
                      : st === "g"
                        ? fd!.rows.length >= 9
                          ? "dj-mb-h3"
                          : fd!.rows.length >= 6
                            ? "dj-mb-h2"
                            : "dj-mb-g"
                        : "",
              we ? "dj-mb-we" : "",
              fd?.note ? "dj-mb-note" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <button
                type="button"
                key={d}
                className={`dj-mb-cell ${cls}`}
                title={dayTitleOf(ym.y, ym.m, d)}
                onClick={() => jump(d)}
              />
            );
          })}
        </div>
        <span className="dj-mb-legend">
          {t("格 = 日")} · {t("蓝 = 今天")} · {t("内框 = 有便签")}
        </span>
      </div>
      <div className="dj-flow">
        {flowDays.length === 0 && (
          <div className="dj-gap">
            <span>{t("本月无记录——空日也能写便签:切月视图点任意日直达")}</span>
          </div>
        )}
        {flowDays.map((fd) => {
          const gap = prevD !== null && prevD - fd.d > 1 ? <div className="dj-gap" key={`gap${fd.d}`}><span>{t("{n} 天空白", { n: prevD - fd.d - 1 })}</span></div> : null;
          prevD = fd.d;
          return (
            <div key={fd.key}>
              {gap}
              <DayCard ym={ym} day={fd} today={fd.key === today} />
            </div>
          );
        })}
        <div className="dj-gap">
          <span>{t("向上翻上月 →")}</span>
        </div>
      </div>
    </div>
  );
}
