/**
 * 右栏「每日日志」面板(rail 入口;centerTab 联动开中央主视图)——
 * 月导航 + 轴视图实体(原中央轴视图迁此;统计/待生成块由轴流本身承载:
 * 待生成日在流里即待提取卡)。数据复用 journalStore。
 */
import { useEffect, useMemo, useState } from "react";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { findWorkspaceOrigin } from "@kernel/workspaceOrigins";
import { useWorkspaces } from "@kernel/workspace";
import { useJournalState, type MonthSnapshot } from "./journalStore";
import { useDaySessions, todayKey } from "./daySessions";
import { pad2 } from "./journalFiles";
import { monthTitleOf } from "./dateTitle";
import { ensureHolidays } from "./holidays";
import { FlowView } from "./FlowView";

export function JournalPanel() {
  const state = useJournalState();
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() + 1 });
  const nav = (delta: number) =>
    setYm((prev) => {
      const d = new Date(prev.y, prev.m - 1 + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() + 1 };
    });
  const { list } = useWorkspaces();
  const workspaces = useMemo(
    () => list.filter((w) => !findWorkspaceOrigin(w)?.remoteExec),
    [list],
  );
  const { days: sessions } = useDaySessions(workspaces, 0);
  useEffect(() => {
    void ensureHolidays(ym.y); /* 跨年导航即拉当年(FlowView 只读 holOf) */
  }, [ym.y]);
  const snap: MonthSnapshot | undefined = state.months[`${ym.y}-${pad2(ym.m)}`];
  return (
    <div className="dj-panel">
      <div className="dj-panel-nav">
        <button type="button" className="dj-btn" aria-label={t("上个月")} onClick={() => nav(-1)}>
          <CaretLeft size="0.75rem" />
        </button>
        <span className="dj-month-title">{monthTitleOf(ym.y, ym.m)}</span>
        <button type="button" className="dj-btn" aria-label={t("下个月")} onClick={() => nav(1)}>
          <CaretRight size="0.75rem" />
        </button>
        {/* 回本月:面板翻去远处后一键回(此前翻 1 月要连点 8 次) */}
        <button
          type="button"
          className="dj-btn"
          aria-label={t("回到本月")}
          title={t("回到本月")}
          onClick={() => {
            const now = new Date(); /* 实时取,跨零点不落昨月 */
            setYm({ y: now.getFullYear(), m: now.getMonth() + 1 });
          }}
        >
          {t("今")}
        </button>
      </div>
      <div className="dj-panel-flow">
        {sessions === null ? (
          <div className="dj-panel-stat">{t("加载中…")}</div>
        ) : !snap ? (
          <div className="dj-panel-stat">{t("加载中…")}</div>
        ) : (
          <FlowView ym={ym} snap={snap} sessions={sessions} today={todayKey()} />
        )}
      </div>
    </div>
  );
}
