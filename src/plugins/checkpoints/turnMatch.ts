/**
 * 时间线 ↔ 审批线正向映射 —— prompt 文本全等配对(候选8,feasibility §8)。
 *
 * 键 = prompt 原文:账本随锚点固化的 prompt 与转录侧用户消息同源同文
 * (CLI 规范化/截断即 miss,chip 不渲染,不猜测)。多轮同文按各自出现序
 * 配对:锚点与批次都是会话内单调序列,第 k 条同文消息 ↔ 第 k 个同文批次
 * (index 升序)即「seq 最近匹配」。CliUserMessage 无时间戳,时间谓词
 * 不可用 —— 文本配对绕开,适配器零改动(时间线面板头注同款边界)。
 */
import type { CkptBatch } from "@kernel/ipc";

/** 参与配对的最小消息面(锚点/时间线条目;按会话内出现序传入)。 */
export interface PromptTurn {
  id: string;
  text: string;
}

/**
 * 消息 → 批次映射;未匹配的消息不在表内(调用方不渲染 chip)。
 * 空 prompt 批次(guard/edit 轮或旧账本)不参与配对。
 */
export function matchTurnBatches(
  turns: readonly PromptTurn[],
  batches: readonly CkptBatch[],
): Map<string, CkptBatch> {
  const byPrompt = new Map<string, CkptBatch[]>();
  for (const b of [...batches].sort((x, y) => x.index - y.index)) {
    if (!b.prompt) continue;
    const list = byPrompt.get(b.prompt);
    if (list) list.push(b);
    else byPrompt.set(b.prompt, [b]);
  }
  const matched = new Map<string, CkptBatch>();
  const cursor = new Map<string, number>();
  for (const t of turns) {
    const list = byPrompt.get(t.text);
    if (!list) continue;
    const k = cursor.get(t.text) ?? 0;
    cursor.set(t.text, k + 1);
    if (k < list.length) matched.set(t.id, list[k]);
  }
  return matched;
}
