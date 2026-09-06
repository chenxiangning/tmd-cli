/**
 * Graph 泳道几何常数 —— 自 GraphCells.tsx 拆出(文件规模铁则)。
 * 布局对齐 VS Code SCM Graph:泳道宽 11px,行高 22,圆点落在 11*(col+1);
 * GraphCells(连线)与 GraphMarker(圆点)共享同一来源,避免双写漂移。
 */

export const GRAPH_SWIMLANE_WIDTH = 11;
export const GRAPH_SVG_HEIGHT = 22;
export const GRAPH_DOT_Y = GRAPH_SWIMLANE_WIDTH;
export const GRAPH_DOT_R = 4;
export const GRAPH_STROKE_W = 2;
export const GRAPH_LINE_W = 1;
export const GRAPH_CURVE_R = 5;
