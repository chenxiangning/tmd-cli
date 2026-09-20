/**
 * 增强提示词引擎面 —— 8 家 CLI 一次性 print 模式的 argv 组装与执行收口。
 * 本机实证(2026-09-21 逐家 --help):claude/qoder/omp/pi `-p`、codex `exec`、
 * opencode `run`、kimi/grok `-p <值>`;模型旗标 claude/omp/pi 用 `--model`,其余 `-m`。
 * CLI 私有 argv 知识只落本文件;执行走 proc_communicate 通用原语(Rust 零改动)。
 */

import { ipc } from "@kernel/ipc";

export interface EnhanceEngineAdapter {
  id: string;
  command: string;
  buildArgs(prompt: string, model: string | null): string[];
}

function modelArgs(flag: string, model: string | null): string[] {
  const m = model?.trim();
  return m ? [flag, m] : [];
}

export const ENHANCE_ENGINES: EnhanceEngineAdapter[] = [
  { id: "claude", command: "claude", buildArgs: (p, m) => ["-p", p, ...modelArgs("--model", m)] },
  { id: "codex", command: "codex", buildArgs: (p, m) => ["exec", ...modelArgs("-m", m), p] },
  { id: "omp", command: "omp", buildArgs: (p, m) => ["-p", ...modelArgs("--model", m), p] },
  { id: "pi", command: "pi", buildArgs: (p, m) => ["-p", ...modelArgs("--model", m), p] },
  { id: "opencode", command: "opencode", buildArgs: (p, m) => ["run", ...modelArgs("-m", m), p] },
  { id: "kimi", command: "kimi", buildArgs: (p, m) => ["-p", ...modelArgs("-m", m), p] },
  { id: "qoder", command: "qoder", buildArgs: (p, m) => ["-p", ...modelArgs("-m", m), p] },
  { id: "grok", command: "grok", buildArgs: (p, m) => ["-p", ...modelArgs("-m", m), p] },
];

export type EnhancePreset = "light" | "structured" | "executable";

const PRESET_RULES: Record<EnhancePreset, string> = {
  light: "- 只整理措辞与清晰度,短句不扩写;草稿已清晰时仅做轻度润色。",
  structured: "- 用简洁小节重组(如 目标/背景/约束/输出/验收),仅在有帮助时分节。",
  executable: "- 最多输出 6 行短句,纯文本;删除填充词与元语言,只保留可执行的约束与交付格式。",
};

/** 组装一次改写的完整指令(base + 档位约束 + 草稿);指令要求保留草稿原语言。 */
export function buildEnhanceInstruction(draft: string, preset: EnhancePreset): string {
  return [
    "你是一名提示词改写助手。",
    "把用户的草稿改写为更清晰、更可执行的 AI 助手提示词。",
    "要求:",
    "- 保留原始意图、语言和明确事实。",
    "- 不要回答请求本身。",
    "- 草稿含糊时,在不虚构新事实的前提下改善结构与清晰度。",
    PRESET_RULES[preset],
    "- 只输出改写后的提示词文本,不要解释、不要 markdown 代码块、不要前言。",
    "",
    "用户草稿:",
    draft,
  ].join("\n");
}

/** 剥整段 ``` 围栏(指令已禁止但仍偶发);非全围栏形态原样返回。 */
export function stripCodeFence(text: string): string {
  const m = text.match(/^```[^\n]*\n([\s\S]*?)\n?```\s*$/);
  return m ? m[1] : text;
}

export function clampTimeoutSeconds(v: number): number {
  if (!Number.isFinite(v)) return 60;
  return Math.min(300, Math.max(5, Math.round(v)));
}

export type EnhanceOutcome =
  | { ok: true; text: string }
  | { ok: false; kind: "timeout" | "empty" | "engine"; detail?: string };

/** 一次性跑选中 CLI 的 print 模式改写草稿;closeStdin = 一次性 CLI 等管道 EOF 的纪律。 */
export async function runEnhance(opts: {
  engineId: string;
  draft: string;
  preset: EnhancePreset;
  model: string | null;
  cwd: string;
  timeoutSeconds: number;
}): Promise<EnhanceOutcome> {
  const adapter = ENHANCE_ENGINES.find((e) => e.id === opts.engineId);
  if (!adapter) return { ok: false, kind: "engine", detail: `未知引擎 ${opts.engineId}` };
  const res = await ipc.procCommunicate({
    command: adapter.command,
    args: adapter.buildArgs(buildEnhanceInstruction(opts.draft, opts.preset), opts.model),
    cwd: opts.cwd,
    closeStdin: true,
    timeoutMs: clampTimeoutSeconds(opts.timeoutSeconds) * 1000,
  });
  if (res.timedOut) return { ok: false, kind: "timeout" };
  if (res.code !== 0) {
    return { ok: false, kind: "engine", detail: res.stderr.trim().slice(0, 400) || `退出码 ${res.code ?? "未知"}` };
  }
  const out = stripCodeFence(res.stdout.trim());
  if (!out) return { ok: false, kind: "empty" };
  return { ok: true, text: out };
}
