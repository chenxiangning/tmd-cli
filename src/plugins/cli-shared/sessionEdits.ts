/**
 * readSessionEdits 尾窗骨架共享库 —— omp/pi/codex/grok 四家适配器的
 * 「jsonl 文本 → 增量写入事件」循环与「尾窗读 → 解析」IO 壳逐行同构,
 * 仅行预筛特征与单行事件抽取是各家私有。2026-09-04 自四份实现收敛。
 *
 * 契约(行为锁step,改动须四家同审):
 * - sinceTs = 水位线:只返回 ts > sinceTs 的事件(增量);
 * - 坏行(尾窗截断)跳过,不致命 —— 宁漏勿误;
 * - 尾窗预算统一 2MB:两次轮询间的写入爆发覆盖在内,超出漏报可接受
 *   (各家注释曾分别强调大补丁/密集编辑/分片流,数值与意图本就同一份)。
 */

import type { CliSessionEdit } from "@kernel/cli";
import { ipc } from "@kernel/ipc";

/** 尾窗预算:2MB(见文件头契约说明)。 */
export const EDITS_TAIL_BYTES = 2 * 1024 * 1024;

/**
 * jsonl 文本 → 增量写入事件(纯函数,可测)。
 * lineFilter: 行预筛(各家私有行前缀/特征字面量);
 * eventsOf: 单行已解析 JSON → 写入事件(非写入类行返回空)。
 */
export function parseEditEventsFromText(
  text: string,
  sinceTs: number,
  cwd: string,
  lineFilter: (line: string) => boolean,
  eventsOf: (entry: Record<string, unknown>, cwd: string) => CliSessionEdit[],
): CliSessionEdit[] {
  const out: CliSessionEdit[] = [];
  for (const line of text.split("\n")) {
    if (!lineFilter(line)) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue; // 尾窗截断的坏行
    }
    for (const event of eventsOf(entry, cwd)) {
      if (event.ts > sinceTs) out.push(event);
    }
  }
  return out;
}

/**
 * 尾窗读取 + 解析(path 由各家定位后传入)。
 * path 为 null(文件尚不存在 = 零事件)返回 [];读取失败返回 null
 * (调用方保水位线重试)。grok 的「失败也按零事件」语义不同,不经此函数。
 */
export async function readEditsTail(
  path: string | null,
  sinceTs: number,
  cwd: string,
  parse: (tail: string, sinceTs: number, cwd: string) => CliSessionEdit[],
): Promise<CliSessionEdit[] | null> {
  if (!path) return [];
  const tail = await ipc.fsReadTail(path, EDITS_TAIL_BYTES).catch(() => null);
  if (tail === null) return null;
  return parse(tail, sinceTs, cwd);
}
