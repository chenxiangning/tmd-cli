/**
 * 工作台 · 手写 SVG 图表四件套(移植 projectHub charts.js 思路):
 * 风险分布环形图、模块负载堆叠条、进度分布直方图、负责人负载排行条。
 * 无第三方图表库;颜色走 --tmd-*,随主题。
 */

import { t } from "@kernel/i18n";
import { accentVar, toneVar } from "./tone";
import { RISK_LABELS, type ModuleLoad, type OwnerLoad, type ProgressBucket, type RiskSlice } from "./insights";

/** 风险分布环形图:多段圆弧,中心放总数。 */
export function DonutChart({ slices, total }: { slices: RiskSlice[]; total: number }) {
  if (total === 0) return null;
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <svg className="wb-donut" viewBox="0 0 140 140" role="img" aria-label={t("风险分布")}>
      {slices.map((slice) => {
        const fraction = slice.count / total;
        const dash = fraction * circumference;
        const el = (
          <circle
            key={slice.level}
            cx="70" cy="70" r={radius}
            fill="none"
            stroke={toneVar(slice.tone)}
            strokeWidth="16"
            strokeDasharray={`${Math.max(dash - 1.5, 0.5)} ${circumference}`}
            strokeDashoffset={-offset}
            transform="rotate(-90 70 70)"
          >
            <title>{`${t(RISK_LABELS[slice.level])} ${slice.count}`}</title>
          </circle>
        );
        offset += dash;
        return el;
      })}
      <text x="70" y="66" textAnchor="middle" className="wb-donut-total">{total}</text>
      <text x="70" y="84" textAnchor="middle" className="wb-donut-caption">项目</text>
    </svg>
  );
}

/** 图例行(与图表同排)。 */
export function SliceLegend({ slices }: { slices: RiskSlice[] }) {
  return (
    <ul className="wb-legend">
      {slices.map((slice) => (
        <li key={slice.level}>
          <i style={{ background: toneVar(slice.tone) }} />
          <span>{t(RISK_LABELS[slice.level])}</span>
          <b>{slice.count}</b>
        </li>
      ))}
    </ul>
  );
}

/** 模块负载堆叠条:一行一模块,危险/关注/正常三段。 */
export function ModuleLoadBars({ rows }: { rows: ModuleLoad[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="wb-loadbars">
      {rows.map((row) => {
        const total = Math.max(row.total, 1);
        return (
          <div key={row.module} className="wb-loadbar-row" title={`${row.module}:${row.total} 个,平均进度 ${row.avgProgress}%`}>
            <span className="wb-loadbar-name">{row.module}</span>
            <span className="wb-loadbar">
              <i style={{ width: `${(row.danger / total) * 100}%`, background: "var(--tmd-err)" }} />
              <i style={{ width: `${(row.watch / total) * 100}%`, background: "var(--tmd-warn)" }} />
              <i style={{ width: `${(row.normal / total) * 100}%`, background: accentVar(row.accent) }} />
            </span>
            <b className="wb-loadbar-n">{row.total}</b>
          </div>
        );
      })}
    </div>
  );
}

/** 进度分布直方图。 */
export function Histogram({ buckets }: { buckets: ProgressBucket[] }) {
  const max = Math.max(1, ...buckets.map((bucket) => bucket.count));
  return (
    <div className="wb-hist">
      {buckets.map((bucket) => (
        <div key={bucket.label} className="wb-hist-col" title={`${bucket.label}:${bucket.count} 个`}>
          <span className="wb-hist-n">{bucket.count || ""}</span>
          <i style={{ height: `${(bucket.count / max) * 72}px` }} />
          <span className="wb-hist-label">{bucket.label}</span>
        </div>
      ))}
    </div>
  );
}

/** 负责人负载排行条(前 6)。 */
export function OwnerRankBars({ rows }: { rows: OwnerLoad[] }) {
  if (rows.length === 0) return null;
  const max = Math.max(1, ...rows.map((row) => row.total));
  return (
    <div className="wb-loadbars">
      {rows.slice(0, 6).map((row) => (
        <div key={row.owner} className="wb-loadbar-row" title={`${row.owner}:${row.total} 个项目,${row.openTasks} 项任务`}>
          <span className="wb-loadbar-name">{row.owner}</span>
          <span className="wb-loadbar">
            <i style={{ width: `${(row.total / max) * 100}%`, background: row.danger > 0 ? "var(--tmd-warn)" : "var(--tmd-accent)" }} />
          </span>
          <b className="wb-loadbar-n">{row.total}</b>
        </div>
      ))}
    </div>
  );
}
