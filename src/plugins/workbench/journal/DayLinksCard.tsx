/**
 * 当日关联区(工作台派生,spec P2):当日会话行 → 项目/任务 chip。
 * 数据经 dayLinks 纯函数运行时派生(wsId↔cwd / TaskSessionLink),点击跳
 * 项目详情中央 tab;任务 chip 落其所属项目(任务级深链无路由,不硬造)。
 */
import { useEffect, useMemo } from "react";
import { useSyncExternalStore } from "react";
import { Kanban, ListChecks } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { findWorkspaceOrigin } from "@kernel/workspaceOrigins";
import { useWorkspaces } from "@kernel/workspace";
import { ensureWorkbenchLoaded, subscribeWorkbench, workbenchSnapshot } from "../store";
import { openProjectTab } from "../wbTabs";
import { dayProjectLinks, dayTaskLinks } from "./dayLinks";
import type { DaySessionRow } from "./daySessions";

export function DayLinks({ rows }: { rows: DaySessionRow[] }) {
  const projects = useSyncExternalStore(subscribeWorkbench, workbenchSnapshot);
  const { list } = useWorkspaces();
  /* 文章 tab 可先于工作台本页打开:确保 index 已加载,否则项目恒空假「无关联」。 */
  useEffect(() => {
    void ensureWorkbenchLoaded();
  }, []);
  const groups = useMemo(
    () => dayProjectLinks(rows, projects, list.filter((w) => !findWorkspaceOrigin(w)?.remoteExec)),
    [rows, projects, list],
  );
  const tasks = useMemo(() => dayTaskLinks(rows, projects), [rows, projects]);
  if (groups.length === 0 && tasks.length === 0) return null;
  return (
    <div className="dj-day-sessions">
      <h4>
        {t("当日关联")}
        <span className="dj-ds-count">
          {t("{n} 个项目", { n: groups.length })} · {t("{n} 个任务", { n: tasks.length })}
        </span>
      </h4>
      <div className="dj-dl-row">
        {groups.map((g) => (
          <button
            key={g.projectId}
            type="button"
            className="dj-dl-chip"
            onClick={() => openProjectTab(g.projectId, g.projectName)}
          >
            <Kanban size="0.75rem" />
            {g.projectName}
            <span className="dj-dl-count">{t("{n} 会话", { n: g.rows.length })}</span>
          </button>
        ))}
        {tasks.map((k) => (
          <button
            key={k.taskId}
            type="button"
            className="dj-dl-chip dj-dl-task"
            title={k.projectName}
            onClick={() => openProjectTab(k.projectId, k.projectName)}
          >
            <ListChecks size="0.75rem" />
            {k.taskTitle}
          </button>
        ))}
      </div>
    </div>
  );
}
