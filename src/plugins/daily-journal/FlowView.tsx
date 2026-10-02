/**
 * 轴视图(宿主:右栏面板 JournalPanel)—— 迷你月条(日格快跳)+ 脊柱叙事流:
 * 有记录的日子出日卡(脊柱节点 + 生长珠子 + 折叠文章卡 + 只读便签),
 * 间隔空白日画 gap(原型 .flow/.day/.spine)。月导航由面板提供,自身不带。
 */
import { useEffect, useMemo, useReducer, useRef } from "react";
import { PencilSimpleLine } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { dayMetaOf, deriveDayStatus, heatOf, heatThresholds, loadMonth, useJournalState, type MonthSnapshot } from "./journalStore";
import type { DaySessionRow } from "./daySessions";
import { openArticleTab } from "./journalTabs";
import { pad2 } from "./journalFiles";
import { ArticleBody, NoteReadonly } from "./articleBody";
import { notePeekOf, statusChip } from "./statusText";
import { holOf, isWorkdayOverride, useHolidays } from "./holidays";
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

/* 折叠态面板级 store(key = 日 key,值 = 用户裁定;无记录回落默认折)。
 * 模块级 + 订阅通知(liveMode.ts 同款 store 律):右栏切走面板/数据重扫导致
 * FlowView 卸载再回来,折叠裁定不重置;月导航换数据同理。 */
const foldedDays = new Map<string, boolean>();
const foldSubs = new Set<() => void>();
function foldOfDay(key: string, def: boolean): boolean {
  return foldedDays.get(key) ?? def;
}
function toggleFoldOfDay(key: string, def: boolean): void {
  foldedDays.set(key, !foldOfDay(key, def));
  foldSubs.forEach((fn) => fn());
}
function subscribeFolds(fn: () => void): () => void {
  foldSubs.add(fn);
  return () => foldSubs.delete(fn);
}

/** 轴卡正文(文章体/失败/待提取/纯便签语义行;纯函数)。 */
function cardBody(day: { article: Article | null; note: DayNote | undefined; rows: DaySessionRow[] }, st: string, lastError?: string): React.ReactNode {
  if (day.article) return <ArticleBody article={day.article} />;
  if (st === "f") return <div className="dj-fcard-hint dj-err">{lastError}</div>;
  if (st === "p") return <div className="dj-fcard-hint">{t("{n} 个会话等待提取。", { n: day.rows.length })}</div>;
  return <div className="dj-fcard-hint">{t("便签独立于文章存在,写下即是记录。")}</div>;
}

/** 日卡(受控折叠:折叠态归 FlowView 根的 store,子卡不自持)。 */
function DayCard({ ym, day, today, folded, onToggle }: { ym: { y: number; m: number }; day: FlowDay; today: boolean; folded: boolean; onToggle: () => void }) {
  const meta = dayMetaOf(day.key);
  const st = deriveDayStatus(day.article, today, day.rows.length, meta);
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
            onClick={onToggle}
          >
            <span className="dj-fcard-date">{dayTitleOf(ym.y, ym.m, day.d)}</span>
            <span className="dj-foldmark">▾</span>
          </button>
          {holOf(ym.y, ym.m, day.d) && <span className="dj-holmini">休·{holOf(ym.y, ym.m, day.d)}</span>}
          <span className={`dj-chip dj-chip-${st === "n" ? "plain" : st}`}>{statusChip(st)}</span>
          {day.article && (
            <span className="dj-fcard-headline" title={day.article.title}>
              {day.article.title}
            </span>
          )}
          {folded && notePeek && (
            <span className="dj-fcard-notepeek" title={notePeek}>
              {/* 密集折叠卡脚注图标:10px 例外档(9px 档收口取消) */}
              <PencilSimpleLine size="0.625rem" /> {notePeek}
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
  /* 折叠 store 订阅:任一日卡切换即重渲染(子卡全受控,无本地态)。 */
  const [, foldBump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => subscribeFolds(foldBump), [foldBump]);
  useEffect(() => {
    void loadMonth(ym.y, ym.m);
  }, [ym, snap]);
  const prefix = `${ym.y}-${pad2(ym.m)}`;
  const days = new Date(ym.y, ym.m, 0).getDate();
  const metaV = useJournalState().meta;
  useHolidays();
  /* 月条热力阈值:当月活跃日 25/50/75 分位(与月/年视图同一函数,同日同色)。 */
  const ts = useMemo(() => {
    const counts: number[] = [];
    for (let d = 1; d <= days; d++) {
      const rows = sessions.get(`${prefix}-${pad2(d)}`);
      if (rows?.length) counts.push(rows.length);
    }
    return heatThresholds(counts);
  }, [sessions, prefix, days]);
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
        <div className="dj-mb-strip" ref={stripRef}>
          {Array.from({ length: days }, (_, i) => i + 1).map((d) => {
            const fd = flowDays.find((x) => x.d === d);
            const meta = fd ? dayMetaOf(fd.key) : { beads: [], updatedAt: 0 };
            const st = fd ? deriveDayStatus(fd.article, fd.key === today, fd.rows.length, meta) : "n";
            /* 调休上班日不画周末描边;热力档与月/年视图同源分位 */
            const we = [0, 6].includes(new Date(ym.y, ym.m - 1, d).getDay()) && !isWorkdayOverride(ym.y, ym.m, d);
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
                        ? `dj-mb-${heatOf(fd!.rows.length, ts)}`
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
          {t("格 = 日")} · {t("蓝 = 今天")} · {t("黄 = 待提取")} · {t("红 = 失败")} · {t("内框 = 有便签")}
        </span>
      </div>
      <div className="dj-flow">
        {flowDays.length === 0 && (
          <div className="dj-gap">
            <span>{t("本月无记录——点上方日格直达任意一天写便签")}</span>
          </div>
        )}
        {flowDays.map((fd) => {
          const gap = prevD !== null && prevD - fd.d > 1 ? <div className="dj-gap" key={`gap${fd.d}`}><span>{t("{n} 天空白", { n: prevD - fd.d - 1 })}</span></div> : null;
          prevD = fd.d;
          return (
            <div key={fd.key}>
              {gap}
              <DayCard
                ym={ym}
                day={fd}
                today={fd.key === today}
                folded={foldOfDay(fd.key, fd.key !== today && !fd.note)}
                onToggle={() => toggleFoldOfDay(fd.key, fd.key !== today && !fd.note)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
