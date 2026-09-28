/**
 * 意图画布 · AI 作画 inbox 协议(tmd-cli 新能力,mossx 无此机制)。
 *
 * 通道:AI 会话把绘图指令写到 ~/.tmd-cli/intent-canvas/<dirKey>/inbox/ai-draw-*.json,
 * 画布 tab 激活期轮询导入 → 投影为 excalidraw 元素 → append 进目标画布 → 消费后
 * 移除源文件(解析失败移 inbox/failed/ 留证)。选 inbox 文件而非让 AI 直写画布
 * 文档,是为了 schema 可控 + 不可能写坏用户手绘内容。
 *
 * PTY 幕布零参与:AI 走文件系统,本插件只读 inbox,符合幕布硬约束。
 */

import { t } from "@kernel/i18n";
import { isRecord } from "./utils/json";
import type { SeedShape } from "./scene/sceneElements";

/** inbox 源文件名(与 aiDrawPrompt 的指令文案配对,两边同步改)。 */
export const AI_DRAW_FILE_RE = /^ai-draw-[\w.-]+\.json$/;

export type AiDrawShape = {
  type: "rectangle" | "ellipse" | "diamond" | "text" | "arrow";
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  fontSize?: number;
  stroke?: string;
  fill?: string;
};

export type AiDrawFile = {
  kind: "intent-canvas-ai-draw";
  version: 1;
  /** 目标画布 id;缺省按 title 找,再缺省新建。 */
  canvasId?: string;
  /** mode:new 时的新画布标题 / canvasId 缺省时的匹配标题。 */
  title?: string;
  mode: "append" | "new";
  summary?: string;
  shapes: AiDrawShape[];
};

export type AiDrawImportResult = { ok: true; canvasId: string; canvasTitle: string };

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const SHAPE_TYPES = new Set(["rectangle", "ellipse", "diamond", "text", "arrow"]);

/** 防御式归一:任何字段不合法即整文件拒绝(AI 输出不信任)。 */
export function parseAiDrawFile(raw: string): AiDrawFile {
  if (raw.length > 512 * 1024) {
    throw new Error(t("指令文件超过 512KB 上限。"));
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed) || parsed.kind !== "intent-canvas-ai-draw" || parsed.version !== 1) {
    throw new Error(t("不是 intent-canvas-ai-draw 指令文件(kind/version 不符)。"));
  }
  if (!Array.isArray(parsed.shapes) || parsed.shapes.length === 0) {
    throw new Error(t("shapes 为空或缺失,至少需要一个图形。"));
  }
  if (parsed.shapes.length > 200) {
    throw new Error(t("shapes 超过 200 个上限,请拆分多次作画。"));
  }
  const shapes: AiDrawShape[] = [];
  for (const item of parsed.shapes) {
    if (!isRecord(item) || !SHAPE_TYPES.has(String(item.type))) {
      throw new Error(t("shapes 里存在不支持的图形类型。"));
    }
    const x = num(item.x);
    const y = num(item.y);
    const width = num(item.width);
    const height = num(item.height);
    if (x === null || y === null || width === null || height === null) {
      throw new Error(t("shapes 的 x/y/width/height 必须是数字。"));
    }
    const clamp = (value: number) => Math.max(-1_000_000, Math.min(1_000_000, value));
    shapes.push({
      type: item.type as AiDrawShape["type"],
      x: clamp(Math.round(x)),
      y: clamp(Math.round(y)),
      width: clamp(Math.round(width)),
      height: clamp(Math.round(height)),
      label: str(item.label) ?? undefined,
      fontSize: num(item.fontSize) ?? undefined,
      stroke: str(item.stroke) ?? undefined,
      fill: str(item.fill) ?? undefined,
    });
  }
  const mode = parsed.mode === "new" ? "new" : "append";
  return {
    kind: "intent-canvas-ai-draw",
    version: 1,
    mode,
    canvasId: str(parsed.canvasId) ?? undefined,
    title: str(parsed.title) ?? undefined,
    summary: str(parsed.summary) ?? undefined,
    shapes,
  };
}

type SnapNode = { id: string; x: number; y: number; width: number; height: number };

/** 点到节点中心的距离最近者(阈值内),用于箭头端点吸附。 */
function nearestNode(nodes: SnapNode[], px: number, py: number, maxDist: number): SnapNode | null {
  let best: SnapNode | null = null;
  let bestDist = maxDist;
  for (const node of nodes) {
    const dist = Math.hypot(px - (node.x + node.width / 2), py - (node.y + node.height / 2));
    if (dist < bestDist) {
      bestDist = dist;
      best = node;
    }
  }
  return best;
}

/** 节点中心朝目标方向的边框交点 —— 箭头端点贴边,不插进节点内部。 */
function borderPoint(node: SnapNode, towardsX: number, towardsY: number): { x: number; y: number } {
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  const dx = towardsX - cx;
  const dy = towardsY - cy;
  if (dx === 0 && dy === 0) {
    return { x: cx, y: node.y + node.height };
  }
  const tx = dx !== 0 ? node.width / 2 / Math.abs(dx) : Infinity;
  const ty = dy !== 0 ? node.height / 2 / Math.abs(dy) : Infinity;
  const t = Math.min(tx, ty);
  return { x: cx + dx * t, y: cy + dy * t };
}

/** AI shapes → 种子图形。label 绑定进形状/箭头(sceneGraph 同款);箭头端点
 * 吸附最近节点并建立绑定 —— AI 只给大概方向,客户端裁到边缘交点,
 * 消「线插进节点/穿过节点」;绑定后拖动节点箭头跟随。 */
export function projectAiDrawShapes(shapes: AiDrawShape[]): SeedShape[] {
  const nodes: SnapNode[] = shapes
    .map((shape, index) => (
      shape.type !== "text" && shape.type !== "arrow"
        ? { id: `intent-ai-draw-${index}`, x: shape.x, y: shape.y, width: shape.width, height: shape.height }
        : null
    ))
    .filter((node): node is SnapNode => node !== null);
  /* 吸附容差:节点对角线 1.6 倍左右,够纠 AI 的粗糙坐标又不误吸远处节点。 */
  const snapDist = Math.max(240, ...nodes.map((n) => Math.hypot(n.width, n.height) * 1.6));
  const out: SeedShape[] = [];
  shapes.forEach((shape, index) => {
    if (shape.type === "arrow") {
      const arrowId = `intent-ai-draw-arrow-${index}`;
      const labelId = `intent-ai-draw-text-${index}`;
      const source = nearestNode(nodes, shape.x, shape.y, snapDist);
      const target = nearestNode(nodes, shape.x + shape.width, shape.y + shape.height, snapDist);
      let x = shape.x;
      let y = shape.y;
      let width = shape.width;
      let height = shape.height;
      if (source && target && source.id !== target.id) {
        const sourceCenter = { x: source.x + source.width / 2, y: source.y + source.height / 2 };
        const targetCenter = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
        const start = borderPoint(source, targetCenter.x, targetCenter.y);
        const end = borderPoint(target, sourceCenter.x, sourceCenter.y);
        x = start.x;
        y = start.y;
        width = end.x - start.x;
        height = end.y - start.y;
      }
      out.push({
        type: "arrow",
        id: arrowId,
        x,
        y,
        width,
        height,
        /* AI 自由发色在暗色主题/浅底上易看不清:统一主题安全调色板(与手绘
           sceneGraph 蓝系同款),忽略 AI 的 stroke 字段。 */
        strokeColor: "#64748b",
        startBindingId: source?.id ?? null,
        endBindingId: source && target && source.id !== target.id ? target.id : null,
        boundElementIds: shape.label ? [labelId] : undefined,
      });
      if (shape.label) {
        out.push({
          type: "text",
          id: labelId,
          x: x + width / 2 - 90,
          y: y + height / 2 - 11,
          width: 180,
          height: 22,
          text: shape.label,
          fontSize: 12,
          strokeColor: "#475569",
          containerId: arrowId,
        });
      }
      return;
    }
    const shapeId = `intent-ai-draw-${index}`;
    if (shape.type === "text" || shape.label) {
      const fontSize = shape.fontSize ?? 20;
      out.push({
        type: "text",
        id: shape.type === "text" ? shapeId : `intent-ai-draw-text-${index}`,
        x: shape.x + (shape.type === "text" ? 0 : 10),
        y: shape.type === "text" ? shape.y : shape.y + Math.max(8, Math.round(shape.height / 2) - fontSize),
        width: Math.max(40, shape.width - 20),
        height: Math.round(fontSize * 1.25),
        text: shape.label ?? "",
        fontSize,
        strokeColor: shape.type === "text" ? "#334155" : "#1d4ed8",
        containerId: shape.type === "text" ? null : shapeId,
      });
    }
    if (shape.type !== "text") {
      out.push({
        type: shape.type,
        x: shape.x,
        y: shape.y,
        width: shape.width,
        height: shape.height,
        strokeColor: "#2563eb",
        backgroundColor: "#eff6ff",
        id: shapeId,
        boundElementIds: shape.label ? [`intent-ai-draw-text-${index}`] : undefined,
      });
    }
  });
  return out;
}

export { pollAiDrawInbox, importAiDrawFile, aiDrawInboxPath } from "./aiDrawImport";
