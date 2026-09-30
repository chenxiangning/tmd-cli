/**
 * 转录分阶段分组模型 —— codemoss process-phase 折叠的只读磁盘版:
 * 默认模式 = 工作过程(reasoning/tool/system)切成带标签的折叠组,assistant
 * 正文永不入组、全尺寸渲染;极简模式 = 每轮过程 + 中途叙述折成单组,只留
 * 最终答复。纯函数,可测。
 */

import type { CliTranscriptBlock } from "@kernel/cli";

/** 组的工作类别(决定折叠头图标)。 */
export type PhaseKind = "look" | "change" | "run" | "think";

export interface TranscriptPhase {
  id: string;
  kind: PhaseKind;
  /** 组内工作过程(reasoning/tool/system;极简模式兼收中途叙述 assistant)。 */
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
 * 块序列 → [用户块 | assistant 正文 | phase 组] 序列。默认规则(codemoss
 * process-phase 同款:正文只折叠其上方紧邻的工作过程,自身永不折叠):
 * - user 块是组边界,自身独立;
 * - assistant 正文(无论长短)收掉当前组,自身全尺寸渲染 —— 短答复按长度
 *   阈值吸进思考折叠是 2026-09-30 实证缺陷(omp「在不在」轮正文进了思考组);
 * - reasoning/tool/system 归当前组(无当前组则开 think 组;kind 随工具类变)。
 *
 * 极简模式(minimal,codemoss resolveMinimalTranscriptCollapsedTimeline 的
 * 只读磁盘版):按 user 块切轮,每轮「工作过程 + 中途叙述散文」整段折叠为
 * 单组,只保留该轮最终答复全尺寸;无正文轮(纯工具收尾)退回默认过程组。
 */

export type TranscriptItem =
  | { kind: "user"; block: CliTranscriptBlock }
  | { kind: "assistant"; block: CliTranscriptBlock }
  | { kind: "phase"; phase: TranscriptPhase };

export interface TranscriptPhasesOptions {
  /** 极简展示:每轮工作过程折叠为单组,只保留最终答复(查看器头部可切)。 */
  minimal?: boolean;
}

export function buildTranscriptPhases(
  blocks: CliTranscriptBlock[],
  options?: TranscriptPhasesOptions,
): TranscriptItem[] {
  return options?.minimal ? buildMinimalPhases(blocks) : buildDefaultPhases(blocks);
}

function buildDefaultPhases(blocks: CliTranscriptBlock[]): TranscriptItem[] {
  const out: TranscriptItem[] = [];
  let current: TranscriptPhase | null = null;
  const push = () => {
    if (current) {
      out.push({ kind: "phase", phase: current });
      current = null;
    }
  };
  for (const block of blocks) {
    if (block.role === "user") {
      push();
      out.push({ kind: "user", block });
      continue;
    }
    if (block.role === "assistant") {
      if (!block.text.trim()) continue;
      push();
      out.push({ kind: "assistant", block });
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

/** 有折叠价值的块:过程类(reasoning/tool/system)恒可折;assistant 只折有字的。 */
function isFoldableStep(block: CliTranscriptBlock): boolean {
  return block.role !== "assistant" || block.text.trim() !== "";
}

/** 步序列的工作类别:首个带 preview.kind 的工具定类,缺省 think。 */
function phaseKindOfSteps(steps: CliTranscriptBlock[]): PhaseKind {
  for (const step of steps) {
    const kind = phaseKindOfTool(step);
    if (kind) return kind;
  }
  return "think";
}

function buildMinimalPhases(blocks: CliTranscriptBlock[]): TranscriptItem[] {
  const out: TranscriptItem[] = [];
  let segment: CliTranscriptBlock[] = [];
  const flush = () => {
    if (segment.length > 0) {
      emitMinimalTurn(out, segment);
      segment = [];
    }
  };
  for (const block of blocks) {
    if (block.role === "user") {
      flush();
      out.push({ kind: "user", block });
      continue;
    }
    segment.push(block);
  }
  flush();
  return out;
}

/** 单轮极简折叠:最终答复(轮内最后一条有字散文)全尺寸,其余整段收一组。 */
function emitMinimalTurn(out: TranscriptItem[], segment: CliTranscriptBlock[]): void {
  const prose = segment.filter((b) => b.role === "assistant" && b.text.trim());
  if (prose.length === 0) {
    /* 无正文轮(纯工具/系统收尾):不产极简 chip,按默认规则收过程组。 */
    const foldable = segment.filter(isFoldableStep);
    if (foldable.length > 0) {
      out.push({
        kind: "phase",
        phase: { id: foldable[0].id, kind: phaseKindOfSteps(foldable), steps: foldable },
      });
    }
    return;
  }
  const anchor = prose[prose.length - 1];
  const hidden = segment.filter((b) => b !== anchor && isFoldableStep(b));
  if (hidden.length > 0) {
    out.push({
      kind: "phase",
      phase: { id: `turn:${anchor.id}`, kind: phaseKindOfSteps(hidden), steps: hidden },
    });
  }
  out.push({ kind: "assistant", block: anchor });
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

/** 组折叠头标题:首工具标签;缺省「思考」(纯 reasoning 组)。 */
export function phaseTitle(phase: TranscriptPhase): string {
  const firstTool = phase.steps.find((s) => s.role === "tool");
  if (firstTool) {
    const label = toolRowLabel(firstTool);
    const rest = phase.steps.filter((s) => s.role === "tool").length - 1;
    return rest > 0 ? `${label} +${rest}` : label;
  }
  return "思考";
}
