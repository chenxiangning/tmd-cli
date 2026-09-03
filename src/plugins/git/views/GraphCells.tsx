/**
 * Graph 泳道 SVG 单元 —— HistoryView 行首列的绘制件。
 *
 * 布局常数与路径形状对齐 VS Code SCM Graph:泳道宽 11px,行高 22,
 * 圆点落在 11*(col+1);merge 的第二父从圆点弧线分支出去。
 */

import { GRAPH_COLORS, type GraphColor, type GraphRow } from "../graph/gitGraph";

const GRAPH_SWIMLANE_WIDTH = 11;
const GRAPH_SVG_HEIGHT = 22;
const GRAPH_DOT_Y = GRAPH_SWIMLANE_WIDTH;
const GRAPH_DOT_R = 4;
const GRAPH_STROKE_W = 2;
const GRAPH_LINE_W = 1;
const GRAPH_CURVE_R = 5;

/** 本行 SVG 宽 = 泳道数 + 1 的空当,留出右侧呼吸位。 */
function graphColumnCount(row: GraphRow) {
  return Math.max(row.inputLanes.length, row.outputLanes.length, row.commitCol + 1, 1);
}

function graphLayoutWidth(row: GraphRow) {
  return GRAPH_SWIMLANE_WIDTH * (graphColumnCount(row) + 1);
}

function graphLaneX(col: number) {
  return GRAPH_SWIMLANE_WIDTH * (col + 1);
}

/** 调色板序号 → 具体色;字符串(CSS 变量)原样透传。 */
function graphColor(color: GraphColor) {
  if (typeof color === "string") return color;
  return GRAPH_COLORS[
    ((color % GRAPH_COLORS.length) + GRAPH_COLORS.length) % GRAPH_COLORS.length
  ];
}

function graphVerticalPath(col: number, y1 = 0, y2 = GRAPH_SVG_HEIGHT) {
  const x = graphLaneX(col);
  return `M ${x} ${y1} V ${y2}`;
}

/** 同列延续:直线;异列汇入:上缘四分之一弧 + 横移。 */
function graphCommitJoinPath(fromCol: number, toCol: number) {
  if (fromCol === toCol) return graphVerticalPath(fromCol, 0, GRAPH_DOT_Y);
  const x1 = graphLaneX(fromCol);
  const x2 = graphLaneX(toCol);
  const direction = toCol > fromCol ? 1 : -1;
  return [
    `M ${x1} 0`,
    `A ${GRAPH_SWIMLANE_WIDTH} ${GRAPH_SWIMLANE_WIDTH} 0 0 ${direction > 0 ? 0 : 1} ${
      x1 + direction * GRAPH_SWIMLANE_WIDTH
    } ${GRAPH_DOT_Y}`,
    `H ${x2}`,
  ].join(" ");
}

/** merge 第二父的分支弧:从圆点右侧出去,落进父泳道。 */
function graphParentBranchPath(fromCol: number, toCol: number) {
  if (fromCol === toCol) return "";
  const circleX = graphLaneX(fromCol);
  const branchX = GRAPH_SWIMLANE_WIDTH * toCol;
  const parentX = graphLaneX(toCol);
  return [
    `M ${branchX} ${GRAPH_DOT_Y}`,
    `A ${GRAPH_SWIMLANE_WIDTH} ${GRAPH_SWIMLANE_WIDTH} 0 0 1 ${parentX} ${GRAPH_SVG_HEIGHT}`,
    `M ${branchX} ${GRAPH_DOT_Y}`,
    `H ${circleX}`,
  ].join(" ");
}

/** 圆点颜色:优先本行 commitCol 上的输出 lane(延续色),退回 commitColor。 */
function graphCircleColor(row: GraphRow) {
  const lane = row.outputLanes[row.commitCol] ?? row.inputLanes[row.commitCol];
  return graphColor(lane?.color ?? row.commitColor);
}

function findLastGraphLaneIndex(lanes: GraphRow["outputLanes"], id: string) {
  for (let index = lanes.length - 1; index >= 0; index--) {
    if (lanes[index].id === id) return index;
  }
  return -1;
}

/** 圆点造型:head 空心环 / merge 双圈 / 合成行虚线圈 / 普通实心点。 */
function GitGraphCommitMarker({
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

/** 提交行左列:入线汇入 + 出线分支 + 圆点。 */
export function GitGraphSvgCell({ row }: { row: GraphRow }) {
  const layoutW = graphLayoutWidth(row);
  const cx = graphLaneX(row.commitCol);
  const commitColor = graphCircleColor(row);
  const commitInputColor = graphColor(row.commitColor);
  let outputIndex = 0;

  return (
    <div
      className="shrink-0 self-center overflow-visible"
      style={{ width: layoutW, minWidth: layoutW, height: GRAPH_SVG_HEIGHT }}
    >
      <svg
        width={layoutW}
        height={GRAPH_SVG_HEIGHT}
        className="block overflow-visible"
        aria-hidden="true"
        style={{ shapeRendering: "geometricPrecision" }}
      >
        {row.inputLanes.map((lane, index) => {
          if (lane.id === row.sha) {
            if (index !== row.commitCol) {
              // lane 从别的列汇入本提交:弧线接管
              return (
                <path
                  key={`join-${index}-${lane.id}`}
                  d={graphCommitJoinPath(index, row.commitCol)}
                  fill="none"
                  stroke={graphColor(lane.color)}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={GRAPH_LINE_W}
                />
              );
            }
            outputIndex++;
            return null;
          }

          if (outputIndex < row.outputLanes.length && lane.id === row.outputLanes[outputIndex].id) {
            if (index === outputIndex) {
              outputIndex++;
              return (
                <path
                  key={`lane-${index}-${lane.id}`}
                  d={graphVerticalPath(index)}
                  fill="none"
                  stroke={graphColor(lane.color)}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={GRAPH_LINE_W}
                />
              );
            }

            // 同一 lane 跨行收拢(旧列 → 新列):S 形弧
            const d: string[] = [];
            d.push(`M ${graphLaneX(index)} 0`);
            d.push(`V 6`);
            d.push(
              `A ${GRAPH_CURVE_R} ${GRAPH_CURVE_R} 0 0 1 ${graphLaneX(index) - GRAPH_CURVE_R} ${GRAPH_DOT_Y}`,
            );
            d.push(`H ${graphLaneX(outputIndex) + GRAPH_CURVE_R}`);
            d.push(
              `A ${GRAPH_CURVE_R} ${GRAPH_CURVE_R} 0 0 0 ${graphLaneX(outputIndex)} ${
                GRAPH_DOT_Y + GRAPH_CURVE_R
              }`,
            );
            d.push(`V ${GRAPH_SVG_HEIGHT}`);
            outputIndex++;
            return (
              <path
                key={`lane-${index}-${lane.id}`}
                d={d.join(" ")}
                fill="none"
                stroke={graphColor(lane.color)}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={GRAPH_LINE_W}
              />
            );
          }

          return null;
        })}

        {row.parents.slice(1).map((parentId) => {
          const parentIndex = findLastGraphLaneIndex(row.outputLanes, parentId);
          if (parentIndex === -1 || parentIndex === row.commitCol) {
            return null;
          }
          return (
            <path
              key={`parent-${parentId}`}
              d={graphParentBranchPath(row.commitCol, parentIndex)}
              fill="none"
              stroke={graphColor(row.outputLanes[parentIndex].color)}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={GRAPH_LINE_W}
            />
          );
        })}

        {row.inputLanes.some((lane) => lane.id === row.sha) ? (
          <path
            d={graphVerticalPath(row.commitCol, 0, GRAPH_DOT_Y)}
            fill="none"
            stroke={commitInputColor}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={GRAPH_LINE_W}
          />
        ) : null}

        {row.parents.length > 0 ? (
          <path
            d={graphVerticalPath(row.commitCol, GRAPH_DOT_Y, GRAPH_SVG_HEIGHT)}
            fill="none"
            stroke={commitColor}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={GRAPH_LINE_W}
          />
        ) : null}

        <GitGraphCommitMarker
          cx={cx}
          color={commitColor}
          kind={row.kind}
          isHead={row.isHead}
          isMerge={row.isMerge}
        />
      </svg>
    </div>
  );
}

/** 文件行/展开行左列:只画纵向延续线,视觉上属于上方提交。 */
export function GitGraphContinuationCell({ row }: { row: GraphRow }) {
  const layoutW = graphLayoutWidth(row);
  return (
    <div
      className="shrink-0 self-center overflow-visible"
      style={{ width: layoutW, minWidth: layoutW, height: GRAPH_SVG_HEIGHT }}
      aria-hidden="true"
    >
      <svg
        width={layoutW}
        height={GRAPH_SVG_HEIGHT}
        aria-hidden="true"
        className="block overflow-visible"
        style={{ shapeRendering: "geometricPrecision" }}
      >
        {row.outputLanes.map((lane, index) => (
          <path
            key={`c${index}:${lane.id}`}
            d={graphVerticalPath(index)}
            fill="none"
            stroke={graphColor(lane.color)}
            strokeLinecap="round"
            strokeWidth={GRAPH_LINE_W}
          />
        ))}
      </svg>
    </div>
  );
}

