/**
 * 意图画布 · 发送格式化(自 context.ts 拆出,守行数铁则)。
 * buildIntentCanvasContextAttachment:JSON 信封;formatIntentCanvasThreadContext:
 * 中文审计头 + markdown + 内嵌压缩 JSON payload(mossx 同构,marker 与
 * messageContext 解析端配对,两边同步改)。
 */

import type { IntentCanvasContextSendAttachment } from "../semantic";
import type { IntentCanvasDocument } from "../types";
import { buildIntentCanvasTransmissionContext } from "./context";
import { countVisualElements, hasDisplayEllipsis } from "./contextDigest";

export function buildIntentCanvasContextAttachment(
  document: IntentCanvasDocument,
  workspaceName: string | null | undefined,
): IntentCanvasContextSendAttachment {
  const transmissionContext = buildIntentCanvasTransmissionContext(document, workspaceName);
  const rawPayload = JSON.stringify(transmissionContext);
  const completeness = transmissionContext.completeness;
  return {
    kind: "intent_canvas_context",
    attachmentId: `intent-canvas-${document.id}-${document.updatedAt}`,
    canvasId: document.id,
    title: document.title,
    mode: document.mode,
    compressionMode: completeness.compressionMode,
    truncated: completeness.truncated,
    payloadCharacters: rawPayload.length,
    rawPayload,
    semanticNodes: completeness.semanticNodes,
    semanticEdges: completeness.semanticEdges,
    evidence: completeness.evidence,
    visualTextBlocks: completeness.visualTextBlocks,
  };
}

function listOrNone(items: string[]): string[] {
  return items.length > 0 ? items.map((item) => `- ${item}`) : ["- none"];
}

function formatCountLine(label: string, value: { total: number; sent: number; omitted: number }): string {
  const omitted = value.omitted > 0 ? `, omitted ${value.omitted}` : "";
  return `- ${label}: ${value.sent}/${value.total}${omitted}`;
}

export function formatIntentCanvasThreadContext(
  document: IntentCanvasDocument,
  workspaceName: string | null | undefined,
): string {
  const transmissionContext = buildIntentCanvasTransmissionContext(document, workspaceName);
  const compactTransmissionPayload = JSON.stringify(transmissionContext);
  const visualCountsForAudit = countVisualElements(document);
  const payloadContainsLiteralEllipsis = hasDisplayEllipsis(compactTransmissionPayload);
  const modeLabel =
    document.mode === "architect"
      ? "架构师白板 Architect Canvas"
      : document.mode === "spotlight"
        ? "代码探照灯 Code Spotlight"
        : "文件意图图 File Intent Canvas";

  return [
    "请把下面的 Intent Canvas 当作本轮对话的结构化上下文。",
    "它是用户绘制的意图/逻辑图，不代表代码已经实现，也不要自动写回 Project Map 事实。",
    "上下文已做语义压缩：优先保留 Project Map 语义节点、关系、文件路径、证据线索和用户手写文本；视觉坐标、颜色、尺寸等低价值绘图信息默认不发送。",
    "审计口径：下面的 JSON 是本次实际发送给模型的完整 transmission payload；它不是原始 Excalidraw scene 全量导出。",
    "JSON 使用 compact/minified 格式压缩展示体积，不省略字段；如果 truncated=yes 或任一 omitted > 0，表示内容层做了显式语义压缩，不是静默截断。",
    "",
    `Canvas: ${document.title}`,
    `Mode: ${modeLabel}`,
    `Workspace: ${workspaceName ?? document.workspace.name ?? "unknown"}`,
    `Updated: ${document.updatedAt}`,
    `Compression mode: ${transmissionContext.completeness.compressionMode}`,
    "",
    "Payload audit:",
    "- JSON payload complete: yes",
    "- JSON format: compact/minified",
    "- Raw canvas scene complete: no; low-value visual coordinates/styles are summarized",
    "- Display-abbreviated visual text with literal ellipsis is excluded from JSON visualClues",
    `- Literal ellipsis remains in JSON: ${payloadContainsLiteralEllipsis ? "yes" : "no"}`,
    `- Display-abbreviated visual text excluded: ${visualCountsForAudit.displayAbbreviatedTextBlockCount}`,
    `- Content truncated: ${transmissionContext.completeness.truncated ? "yes" : "no"}`,
    `- Payload characters: ${compactTransmissionPayload.length}`,
    "",
    "Intent Summary:",
    document.summary.trim() || "未填写",
    "",
    "Linked files:",
    ...listOrNone(document.links.filePaths),
    "",
    "Linked Project Map nodes:",
    ...listOrNone(document.links.projectMapNodeIds),
    "",
    "Linked threads:",
    ...listOrNone(document.links.threadIds),
    "",
    "Context completeness:",
    formatCountLine("visual digest elements", transmissionContext.completeness.elements),
    formatCountLine("semantic nodes", transmissionContext.completeness.semanticNodes),
    formatCountLine("semantic edges", transmissionContext.completeness.semanticEdges),
    formatCountLine("evidence clues", transmissionContext.completeness.evidence),
    formatCountLine("visual text blocks", transmissionContext.completeness.visualTextBlocks),
    formatCountLine("visual arrows", transmissionContext.completeness.visualArrows),
    `- unlabeled visual shapes compressed: ${transmissionContext.completeness.unlabeledShapeCount}`,
    `- truncated: ${transmissionContext.completeness.truncated ? "yes" : "no"}`,
    "",
    "Structured transmission payload compact JSON:",
    "```json",
    compactTransmissionPayload,
    "```",
  ].join("\n");
}
