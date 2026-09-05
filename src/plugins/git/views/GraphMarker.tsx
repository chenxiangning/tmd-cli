/**
 * GitGraphCommitMarker —— 自 GraphCells.tsx 拆出(文件规模铁则)。
 * 圆点造型四态:head 空心环 / merge 双圈 / 合成行(传入传出)虚线圈 / 普通实心点;
 * 几何常数与 GraphCells 共享(自 graphGeometry 导入,保持单一来源)。
 */

import type { GraphRow } from "../graph/gitGraph";
import { GRAPH_DOT_R, GRAPH_DOT_Y, GRAPH_STROKE_W } from "./graphGeometry";

export function GitGraphCommitMarker({
  cx,
  color,
  kind,
  isHead,
  isMerge,
}: {
  cx: number;
  color: string;
  kind: GraphRow["kind"];
  isHead: boolean;
  isMerge: boolean;
}) {
  if (kind === "incoming-changes" || kind === "outgoing-changes") {
    return (
      <g>
        <circle
          cx={cx}
          cy={GRAPH_DOT_Y}
          r={GRAPH_DOT_R + 3}
          fill={color}
          stroke="var(--tmd-bg-base)"
          strokeWidth={GRAPH_STROKE_W}
        />
        <circle
          cx={cx}
          cy={GRAPH_DOT_Y}
          r={GRAPH_DOT_R + 1}
          fill="var(--tmd-bg-base)"
          stroke="var(--tmd-bg-base)"
          strokeWidth={GRAPH_STROKE_W + 1}
        />
        <circle
          cx={cx}
          cy={GRAPH_DOT_Y}
          r={GRAPH_DOT_R + 1}
          fill="none"
          stroke={color}
          strokeDasharray="4 2"
          strokeWidth={Math.max(1, GRAPH_STROKE_W - 1)}
        />
      </g>
    );
  }

  if (isHead) {
    return (
      <g>
        <circle
          cx={cx}
          cy={GRAPH_DOT_Y}
          r={GRAPH_DOT_R + 3}
          fill={color}
          stroke="var(--tmd-bg-base)"
          strokeWidth={GRAPH_STROKE_W}
        />
        <circle
          cx={cx}
          cy={GRAPH_DOT_Y}
          r={GRAPH_DOT_R - 2}
          fill="var(--tmd-bg-base)"
          stroke="var(--tmd-bg-base)"
          strokeWidth={GRAPH_DOT_R}
        />
      </g>
    );
  }

  if (!isMerge) {
    return (
      <circle
        cx={cx}
        cy={GRAPH_DOT_Y}
        r={GRAPH_DOT_R + 1}
        fill={color}
        stroke="var(--tmd-bg-base)"
        strokeWidth={GRAPH_STROKE_W}
      />
    );
  }

  return (
    <g>
      <circle
        cx={cx}
        cy={GRAPH_DOT_Y}
        r={GRAPH_DOT_R + 2}
        fill={color}
        stroke="var(--tmd-bg-base)"
        strokeWidth={GRAPH_STROKE_W}
      />
      <circle
        cx={cx}
        cy={GRAPH_DOT_Y}
        r={GRAPH_DOT_R - 1}
        fill={color}
        stroke="var(--tmd-bg-base)"
        strokeWidth={GRAPH_STROKE_W}
      />
    </g>
  );
}
