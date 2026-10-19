/**
 * 时间线 ↔ 审批线正向映射 —— 轮号对齐 + 文本全等双闸配对。
 *
 * batch.index 与 kernel 锚点同源:两者都是「会话第 N 条真实用户轮」的
 * 1-based 序号(账本 anchor 逐 promptSent 落号,纯阅读轮占号不出批;
 * kernel anchors 按转录用户消息正序排列)。文本全等闸挡 CLI 规范化/
 * 截断即 miss(chip 不渲染,不猜测);轮号闸挡空批轮挤位 —— 纯按出现序
 * 配对时,同文两轮、首轮纯阅读会把第二条的批挂上第一条消息。
 * CliUserMessage 无时间戳,时间谓词不可用 —— 序号配对绕开,适配器零改动
 * (时间线面板头注同款边界)。
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
  for (let i = 0; i < turns.length; i++) {
    const hit = byPrompt.get(turns[i].text)?.find((b) => b.index === i + 1);
    if (hit) matched.set(turns[i].id, hit);
  }
  return matched;
}
