/**
 * 转录共享纯函数 —— RPC(structured-session)渲染体系的块级底座:
 * toolRowLabel(工具行标签:动词 + 目标;ssToolMeta 消费)、tailLines(运行
 * 输出尾窗钳制;ssToolRow 消费)、capped(正文 10k 截断;流式增量防每
 * delta 全量重解析)。旧 phase 分组模型(buildTranscriptPhases,查看器旧
 * 渲染专属)已删除 —— 2026-11-05 渲染对齐:PTY 查看转录复用 RPC 渲染
 * (SsTurnView/LiveTurn),分组即 SsProcessFold 按轮折叠。
 */

import type { CliTranscriptBlock } from "@kernel/cli";

/** 运行中实时输出尾窗钳制(长输出只看末 N 行,monocode 同款;纯函数可测)。 */
export function tailLines(detail: string, keep = 40): string {
  return detail.split("\n").slice(-keep).join("\n");
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

/** 正文截断:10k 字符(超长正文留头部;工具输出尾窗另见 tailLines)。 */
const TEXT_CAP = 10_000;

export function capped(text: string): string {
  return text.length > TEXT_CAP ? `${text.slice(0, TEXT_CAP)}…` : text;
}
