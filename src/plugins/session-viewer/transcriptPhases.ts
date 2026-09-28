/**
 * 转录分阶段分组模型 —— monocode buildActivityPhases 的只读磁盘版:
 * 把一轮活动块切成带标签的折叠组,assistant 散文开组并做标题,思考/工具/
 * system 行归组内(思考永远是 step 不做标题)。纯函数,可测。
 */

import type { CliTranscriptBlock } from "@kernel/cli";

/** 组的工作类别(决定折叠头图标)。 */
export type PhaseKind = "look" | "change" | "run" | "think";

export interface TranscriptPhase {
  id: string;
  kind: PhaseKind;
  /** 开组的 assistant 散文块(标题兼正文);无则标题用首工具摘要。 */
  headline?: CliTranscriptBlock;
  steps: CliTranscriptBlock[];
}

/** 思考块单行摘要(monocode proseSummary 同款:去 code fence/MD 标记,首段)。 */
export function proseSummary(text: string): string {
  const body = text.replace(/```[\s\S]*?(?:```|$)/g, " ");
  const paragraph =
    body
      .split(/\n\s*\n/)
      .map((part) => part.trim())
      .find(Boolean) ?? "";
  return paragraph
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(\*|_)(.+?)\1/g, "$2")
    .replace(/\s+/g, " ")
    .trim();
}

function phaseKindOfTool(block: CliTranscriptBlock): PhaseKind | null {
  const kind = block.tool?.preview?.kind;
  if (kind === "read" || kind === "search") return "look";
  if (kind === "write") return "change";
  if (kind === "shell") return "run";
  return null;
}

/**
 * 块序列 → [用户块 | phase 组] 序列。规则(monocode 同款裁剪):
 * - user 块是组边界,自身独立;
 * - assistant 正文开新组(headline);后续同类正文追加为组内 step;
 * - reasoning/tool/system 归当前组(无当前组则开 think 组)。
 */
export function buildTranscriptPhases(
  blocks: CliTranscriptBlock[],
): Array<{ kind: "user"; block: CliTranscriptBlock } | { kind: "phase"; phase: TranscriptPhase }> {
  const out: Array<
    { kind: "user"; block: CliTranscriptBlock } | { kind: "phase"; phase: TranscriptPhase }
  > = [];
  let current: TranscriptPhase | null = null;
  const push = () => {
    if (current) out.push({ kind: "phase", phase: current });
    current = null;
  };
  for (const block of blocks) {
    if (block.role === "user") {
      push();
      out.push({ kind: "user", block });
      continue;
    }
    if (block.role === "assistant" && block.text.trim()) {
      push();
      current = { id: block.id, kind: "think", headline: block, steps: [] };
      continue;
    }
    if (!current) current = { id: block.id, kind: "think", steps: [] };
    current.steps.push(block);
    const toolKind = phaseKindOfTool(block);
    if (toolKind && current.kind === "think") current.kind = toolKind;
  }
  push();
  return out;
}

/** 工具行标签:动词 + 目标(mono 参数摘要)。 */
export function toolRowLabel(block: CliTranscriptBlock): string {
  const tool = block.tool;
  const preview = tool?.preview;
  const name = tool?.title ?? "tool";
  if (preview?.kind === "shell") {
    const cmd = (preview.output ?? tool?.detail ?? "").split("\n").find(Boolean) ?? "";
    return cmd ? `${name}  ${cmd.trim()}` : name;
  }
  if (preview?.path) {
    const base = preview.path.split("/").pop() ?? preview.path;
    return `${verbOf(name)}  ${base}`;
  }
  if (preview?.query) return `${name}  ${preview.query}`;
  return name;
}

function verbOf(name: string): string {
  const n = name.toLowerCase();
  if (/(edit|write|patch|apply|create)/.test(n)) return "Edit";
  if (/(^|_)(read|view|cat)(_|$)/.test(n) || n.includes("readfile")) return "Read";
  if (/(grep|glob|search|find|list|tree)/.test(n)) return "Find";
  return name;
}

/** 组折叠头标题:headline 散文首行摘要;缺省用首工具标签;再缺省「思考」。 */
export function phaseTitle(phase: TranscriptPhase): string {
  if (phase.headline) {
    return proseSummary(phase.headline.text) || "工作";
  }
  const firstTool = phase.steps.find((s) => s.role === "tool");
  if (firstTool) {
    const label = toolRowLabel(firstTool);
    const rest = phase.steps.filter((s) => s.role === "tool").length - 1;
    return rest > 0 ? `${label} +${rest}` : label;
  }
  return "思考";
}
