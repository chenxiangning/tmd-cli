/**
 * 工作台 · 手写 SVG 图表:风险分布环形图、进度分布直方图。
 * 无第三方图表库;颜色走 --tmd-*,随主题。
 * (2026-10-12 下线模块负载堆叠条/负责人负载排行条:两轴在单人场景同值。)
 */

import { t } from "@kernel/i18n";
import { toneVar } from "./tone";
import { RISK_LABELS, type ProgressBucket, type RiskSlice } from "./insights";

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
