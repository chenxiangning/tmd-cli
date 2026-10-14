/**
 * 工作台 · 概览视图:KPI 行 + 一句话结论 + 风险分布环形图/进度分布直方图 +
 * 任务统计 + 需要马上处理 + 本周到期。
 * 概览始终看全量(不受左栏筛选影响),筛选联动留给其它页签。
 * 2026-10-12 收敛:模块负载/负责人负载两图建在死轴上(单人场景 16/16 同值),下线。
 */

import { useMemo } from "react";
import { t } from "@kernel/i18n";
import { DANGER_LEVELS, endOfWeek, sortByRisk } from "../analysis";
import { headline, kpis, progressBuckets, riskBreakdown } from "../insights";
import { pulsePartition } from "../focusModel";
import { DonutChart, Histogram, SliceLegend } from "../charts";
import { WbEmpty } from "../ui";
import { DefaultEngineBar } from "./DefaultEngineBar";
import { ProjectCard, type WbScreenProps } from "./cards";

function Kpi({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="wb-kpi" style={tone ? { color: tone } : undefined}>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

export function OverviewScreen({ allProjects, today, onOpen, onNewProject, onLinkWorkspaces }: WbScreenProps) {
  /* A2:概览与聚焦同口径——KPI/风险环/进度分布/结论行只按「被跟踪集」计账
   * (有未完成任务|有 DDL|近 7 天活动,判定复用 focusModel.pulsePartition),
   * 空壳并入一行「未跟踪 N 个」。F5:全部派生 useMemo,消渲染期全表重扫。 */
  const pulse = useMemo(() => pulsePartition(allProjects, today), [allProjects, today]);
  const tracked = useMemo(() => pulse.rows.map((row) => row.project), [pulse]);
  const weekEnd = useMemo(() => endOfWeek(today), [today]);
  const data = useMemo(() => kpis(tracked, today), [tracked, today]);
  const slices = useMemo(() => riskBreakdown(tracked, today), [tracked, today]);
  const progress = useMemo(() => progressBuckets(tracked), [tracked]);
  const weekDue = useMemo(() => {
    const weekEnd = endOfWeek(today);
    return tracked
      .filter((project) => project.dueDate !== undefined && project.dueDate >= today && project.dueDate <= weekEnd)
      .slice(0, 8);
  }, [tracked, today]);
  const danger = useMemo(
    () => sortByRisk(tracked, today).filter((item) => DANGER_LEVELS.includes(item.risk.level)).slice(0, 6),
    [tracked, today],
  );
  if (allProjects.length === 0) {
    return (
      /* section 包层:wb-main 直下子节点会被 flex:1 平分高度,bar 会被挤到半空 */
      <section className="wb-overview-empty">
        <DefaultEngineBar />
        <WbEmpty text={t("还没有项目。一键关联工作区里的项目,或登记几个、生成示例数据看看各个看板长什么样。")}>
          <div className="wb-empty-actions">
            <button type="button" className="wb-btn" onClick={onLinkWorkspaces}>{t("一键关联工作区")}</button>
            <button type="button" className="wb-btn wb-btn-primary" onClick={onNewProject}>{t("新建项目")}</button>
          </div>
        </WbEmpty>
      </section>
    );
  }
  return (
    <div className="wb-overview">
      <DefaultEngineBar />
      {/* tracked 空 + 空壳在场:headline 的「还没有项目」与「N 个未跟踪」同屏自相矛盾,换中性句(R 复审)。 */}
      <p className="wb-headline">{tracked.length === 0 && pulse.ghosts.length > 0 ? t("暂无被跟踪的项目;下方索引可把空壳登记成正式项目。") : headline(tracked, today)}</p>
      {pulse.ghosts.length > 0 ? (
        <p className="wb-headline wb-muted" title={pulse.ghosts.map((ghost) => ghost.name).join(t("、"))}>
          {t("{count} 个未跟踪项目", { count: pulse.ghosts.length })}
        </p>
      ) : null}
      <div className="wb-kpis">
        <Kpi label={t("项目总数")} value={data.total} />
        <Kpi label={t("需关注")} value={data.attention} tone="var(--tmd-warn)" />
        <Kpi label={t("已逾期")} value={data.overdue} tone="var(--tmd-err)" />
        <Kpi label={t("未完成任务")} value={data.openTasks} />
        <Kpi label={t("本周到期")} value={data.weekDue} />
        <Kpi label={t("平均进度")} value={data.avgProgress} tone="var(--tmd-ok)" />
      </div>
      <div className="wb-chart-grid">
        <section className="wb-panel">
          <h4>{t("风险分布")}</h4>
          <div className="wb-donut-row">
            <DonutChart slices={slices} total={data.total} />
            <SliceLegend slices={slices} />
          </div>
        </section>
        <section className="wb-panel">
          <h4>{t("进度分布")}</h4>
          <Histogram buckets={progress} />
        </section>
      </div>
      <div className="wb-attention-grid">
        <section className="wb-panel">
          <h4>{t("任务统计")}</h4>
          <div className="wb-taskstats">
            <div className="wb-taskstats-ring" role="img" aria-label={t("任务完成率")}>
              <svg viewBox="0 0 84 84" width="84" height="84">
                <circle cx="42" cy="42" r="34" fill="none" stroke="color-mix(in srgb, var(--tmd-fg-faint) 16%, transparent)" strokeWidth="9" />
                <circle
                  cx="42" cy="42" r="34" fill="none" stroke="var(--tmd-ok)" strokeWidth="9"
                  strokeLinecap="round" strokeDasharray={`${(data.completion / 100) * 2 * Math.PI * 34} 999`}
                  transform="rotate(-90 42 42)"
                />
                <text x="42" y="47" textAnchor="middle" className="wb-donut-total" style={{ fontSize: "0.9375rem" }}>{data.completion}%</text>
              </svg>
              <span>{t("任务完成率")}</span>
            </div>
            <ul className="wb-taskstats-list">
              <li><span>{t("未完成任务")}</span><b>{data.openTasks}</b></li>
              <li><span>{t("已完成任务数")}</span><b>{data.doneTasks}</b></li>
              <li><span>{t("逾期任务")}</span><b style={{ color: data.taskOverdue > 0 ? "var(--tmd-err)" : undefined }}>{data.taskOverdue}</b></li>
              <li><span>{t("本周到期")}</span><b>{data.weekDue}</b></li>
            </ul>
          </div>
        </section>
        <section className="wb-panel">
          <h4>{t("需要马上处理")}</h4>
          {danger.length === 0
            ? <p className="wb-muted">{t("没有危险级项目。")}</p>
            : (
              <div className="wb-card-grid">
                {danger.map((item) => (
                  <ProjectCard key={item.project.id} project={item.project} today={today} onOpen={onOpen} compact />
                ))}
              </div>
            )}
        </section>
        <section className="wb-panel">
          <h4>{t("本周到期")}<span className="wb-panel-sub">≤ {weekEnd}</span></h4>
          <ul className="wb-mini-list">
            {weekDue.length === 0 ? <p className="wb-muted">{t("本周没有到期项目。")}</p> : weekDue.map((project) => (
              <li key={project.id}>
                <button type="button" className="wb-link" onClick={() => onOpen(project.id)}>{project.name}</button>
                <span className="wb-mini-meta">{project.dueDate} · {project.progress}%</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
