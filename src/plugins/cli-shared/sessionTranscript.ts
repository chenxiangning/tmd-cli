/**
 * 会话转录读取骨架 —— readSessionTranscript 适配器的共享 IO 壳与块后处理
 * (sessionEdits/userMessages 同款分工:行型知识属各 CLI 家族,本模块只编排)。
 *
 * 契约(行为锁,改动须全族同审):
 * - 全量预算 32MB(userMessages FULL_BYTES 同款事故教训:不走 512KB 预览 API),
 *   超限尾窗截断并置 truncated;
 * - 坏行(写一半/截断)JSON.parse 失败跳过,宁漏勿误;
 * - 工具调用与结果按 tool.callId 配对:结果文本并入调用块 detail,孤儿结果
 *   保留为独立块(容错,不静默丢)。
 *
 * 消费先例(cli-shared 准入 ≥2 cli-*):claude 族(claudeTranscript.ts)/
 * pi 族(piFamily)/codex/kimi/dsh 各自目录薄接线;grok 未接入(行型未全实证)。
 */

import { ipc } from "@kernel/ipc";
import type { CliToolPreviewKind, CliToolPreviewLine, CliTranscriptBlock } from "@kernel/cli";

/** 全量读取预算:超出按尾窗截断(标 truncated)。 */
export const TRANSCRIPT_BYTES = 32 * 1024 * 1024;

/** 转录行解析器:一行已解析 JSON → 0..n 块(一行 assistant 消息可拆多块)。 */
export type TranscriptLineParser = (
  event: Record<string, unknown>,
) => CliTranscriptBlock[];

/**
 * 读整份会话文件文本。文件不存在/读取失败返回 null(查看器显错误占位);
 * 文件超预算时尾窗截断,置 truncated。
 */
export async function readTranscriptText(
  path: string,
): Promise<{ text: string; truncated: boolean } | null> {
  const tail = await ipc
    .fsReadTailChanged(path, TRANSCRIPT_BYTES, null)
    .catch(() => null);
  if (tail === null || !tail.changed) return null;
  return { text: tail.text, truncated: tail.size > TRANSCRIPT_BYTES };
}

/** 文本 → 顺序块列表(纯函数,可测)。坏行/非 JSON 行跳过。 */
export function parseTranscriptBlocks(
  text: string,
  lineOf: TranscriptLineParser,
): CliTranscriptBlock[] {
  const out: CliTranscriptBlock[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue; // 写一半的活会话行 / 截断行
    }
    if (!event || typeof event !== "object") continue;
    out.push(...lineOf(event as Record<string, unknown>));
  }
  return out;
}

/** 工具结果块(带 callId、无 status 的 tool 块)并入同 callId 的调用块。 */
export function pairToolResults(blocks: CliTranscriptBlock[]): CliTranscriptBlock[] {
  const out: CliTranscriptBlock[] = [];
  const callById = new Map<string, CliTranscriptBlock>();
  for (const block of blocks) {
    if (block.role === "tool" && block.tool?.callId && !block.tool.status) {
      const call = callById.get(block.tool.callId);
      if (call && call.tool) {
        call.tool.status = "done";
        call.tool.detail = block.text || undefined;
        continue;
      }
    }
    if (block.role === "tool" && block.tool?.callId && block.tool.status) {
      callById.set(block.tool.callId, block);
    }
    out.push(block);
  }
  return out;
}

/** 工具名 → 预览分类启发(各家族工具名不同,共享一张启发表)。 */
export function toolPreviewKindOf(name: string): CliToolPreviewKind | undefined {
  const n = name.toLowerCase();
  if (/(bash|shell|exec|command|terminal|run)/.test(n)) return "shell";
  if (/(^|_)(read|view|cat)(_|$)/.test(n) || n.includes("readfile")) return "read";
  if (/(edit|write|patch|apply|create_file|str_replace)/.test(n)) return "write";
  if (/(grep|glob|search|find|list|tree)/.test(n)) return "search";
  return undefined;
}

/** 写入类工具的字符串载荷 → 预览行(旧文 del 行在前,新文 add 行在后,各行截断)。 */
export function diffLinesFromStrings(
  oldStr: string | undefined,
  newStr: string | undefined,
  capPerSide = 200,
): CliToolPreviewLine[] | undefined {
  const lines: CliToolPreviewLine[] = [];
  if (oldStr) {
    for (const text of oldStr.split("\n").slice(0, capPerSide)) {
      lines.push({ kind: "del", text });
    }
  }
  if (newStr) {
    for (const text of newStr.split("\n").slice(0, capPerSide)) {
      lines.push({ kind: "add", text });
    }
  }
  return lines.length > 0 ? lines : undefined;
}
