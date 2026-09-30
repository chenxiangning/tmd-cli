/**
 * 右栏「每日日志」面板(rail 入口;centerTab 联动开中央主视图)——
 * 轻量概览:本月统计 + 待生成日 + 打开主视图。数据复用 journalStore。
 */
import { useEffect, useMemo } from "react";
import { t } from "@kernel/i18n";
import { findWorkspaceOrigin } from "@kernel/workspaceOrigins";
import { useWorkspaces } from "@kernel/workspace";
import { loadMonth, useJournalState } from "./journalStore";
import { useDaySessions } from "./daySessions";
import { openArticleTab, openJournalTab } from "./journalTabs";
import { pad2 } from "./journalFiles";

export function JournalPanel() {
  const state = useJournalState();
  const now = new Date();
  const ym = { y: now.getFullYear(), m: now.getMonth() + 1 };
  const { list } = useWorkspaces();
  const workspaces = useMemo(
    () => list.filter((w) => !findWorkspaceOrigin(w)?.remoteExec),
    [list],
  );
  const { days: sessions } = useDaySessions(workspaces, 0);
  useEffect(() => {
    void loadMonth(ym.y, ym.m);
  }, [ym.y, ym.m, state.ready]);
  const snap = state.months[`${ym.y}-${pad2(ym.m)}`];
  const prefix = `${ym.y}-${pad2(ym.m)}`;
  const days = sessions ? [...sessions.keys()].filter((k) => k.startsWith(prefix)) : [];
  const pending = days.filter((k) => !snap?.articles[k.slice(8)] && (sessions?.get(k)?.length ?? 0) > 0);
  const arts = days.filter((k) => snap?.articles[k.slice(8)]).length;
  return (
    <div className="dj-panel">
      <button className="dj-panel-open" onClick={openJournalTab}>
        {t("打开每日工作日志")}
      </button>
      <div className="dj-panel-stat">
        {t("{y}年{m}月", { y: ym.y, m: ym.m })}
      </div>
      <div className="dj-panel-stat">
        {t("{days} 天有记录 · {arts} 篇文章", { days: days.length, arts })}
      </div>
      {pending.length > 0 && (
        <div className="dj-panel-pending">
          <div className="dj-panel-sub">{t("{n} 天待生成", { n: pending.length })}</div>
          {pending.map((k) => (
            <button key={k} className="dj-panel-day" onClick={() => openArticleTab(ym.y, ym.m, Number(k.slice(8)))}>
              {Number(k.slice(8))}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
