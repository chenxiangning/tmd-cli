/**
 * 工作台 · 概览视图:KPI 行 + 一句话结论 + 风险分布环形图/模块负载堆叠条/
 * 进度分布直方图/负责人负载排行 + 需要马上处理 + 本周到期。
 * 概览始终看全量(不受左栏筛选影响),筛选联动留给其它页签。
 */

import { t } from "@kernel/i18n";
import { DANGER_LEVELS, endOfWeek, sortByRisk } from "../analysis";
import { headline, kpis, moduleWorkload, ownerWorkload, progressBuckets, riskBreakdown } from "../insights";
import { DonutChart, Histogram, ModuleLoadBars, OwnerRankBars, SliceLegend } from "../charts";
import { WbEmpty } from "../ui";
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
  if (allProjects.length === 0) {
    return (
      <WbEmpty text={t("还没有项目。一键关联工作区里的项目,或登记几个、生成示例数据看看各个看板长什么样。")}>
        <div className="wb-empty-actions">
          <button type="button" className="wb-btn" onClick={onLinkWorkspaces}>{t("一键关联工作区")}</button>
          <button type="button" className="wb-btn wb-btn-primary" onClick={onNewProject}>{t("新建项目")}</button>
        </div>
      </WbEmpty>
    );
  }
  const data = kpis(allProjects, today);
  const slices = riskBreakdown(allProjects, today);
  const weekEnd = endOfWeek(today);
  const weekDue = allProjects
    .filter((project) => project.dueDate !== undefined && project.dueDate >= today && project.dueDate <= weekEnd)
    .slice(0, 8);
  const danger = sortByRisk(allProjects, today).filter((item) => DANGER_LEVELS.includes(item.risk.level)).slice(0, 6);
  return (
    <div className="wb-overview">
      <p className="wb-headline">{headline(allProjects, today)}</p>
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
          <h4>{t("模块负载")}</h4>
          <ModuleLoadBars rows={moduleWorkload(allProjects, today)} />
        </section>
        <section className="wb-panel">
          <h4>{t("进度分布")}</h4>
          <Histogram buckets={progressBuckets(allProjects)} />
        </section>
        <section className="wb-panel">
          <h4>{t("负责人负载")}</h4>
          <OwnerRankBars rows={ownerWorkload(allProjects, today)} />
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
