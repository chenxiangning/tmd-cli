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

export type AiDrawImportResult = { ok: true; canvasTitle: string };

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const SHAPE_TYPES = new Set(["rectangle", "ellipse", "diamond", "text", "arrow"]);

/** 防御式归一:任何字段不合法即整文件拒绝(AI 输出不信任)。 */
export function parseAiDrawFile(raw: string): AiDrawFile {
  if (raw.length > 1024 * 1024) {
    throw new Error(t("指令文件超过 1MB 上限。"));
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

/** AI shapes → 种子图形(带 label 的形状自动补绑定文本,同种子投影管线)。 */
export function projectAiDrawShapes(shapes: AiDrawShape[]): SeedShape[] {
  const out: SeedShape[] = [];
  shapes.forEach((shape, index) => {
    if (shape.type === "text" || shape.label) {
      const fontSize = shape.fontSize ?? (shape.type === "text" ? 20 : 16);
      out.push({
        type: "text",
        x: shape.x + (shape.type === "text" ? 0 : 10),
        y: shape.type === "text" ? shape.y : shape.y + Math.max(8, Math.round(shape.height / 2) - fontSize),
        width: Math.max(40, shape.width - 20),
        height: Math.round(fontSize * 1.25),
        text: shape.label ?? "",
        fontSize,
        strokeColor: shape.stroke ?? (shape.type === "text" ? "#334155" : "#1d4ed8"),
      });
    }
    if (shape.type !== "text") {
      out.push({
        type: shape.type,
        x: shape.x,
        y: shape.y,
        width: shape.width,
        height: shape.height,
        strokeColor: shape.stroke ?? "#334155",
        backgroundColor: shape.fill ?? "transparent",
        id: shape.type === "arrow" ? undefined : `intent-ai-draw-${index}`,
      });
    }
  });
  return out;
}

export { pollAiDrawInbox, importAiDrawFile, aiDrawInboxPath } from "./aiDrawImport";
