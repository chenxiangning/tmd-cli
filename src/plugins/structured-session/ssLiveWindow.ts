/**
 * 活轮过程窗切分 —— 滚动批次折叠(2026-11-06 spec,用户拍板):
 * 过程块(reasoning|tool)按块序混池,可见窗恒定最新 3 个;更早的依次收进
 * 一个折叠组头(渲染层交给 SsProcessFold,头形态同落定态整体折叠)。窗内
 * 必须含至少一个思考块:工具连发把最近思考挤出窗时,挤出窗内最老的工具块、
 * 换入其前最近的思考块(窗仍 3 个)。轮内尚无任何思考(开头直发工具)时约束
 * 不触发。纯渲染推导,无批次状态;轮落定切 SsTurnView 整体折叠时天然归零。
 * assistant/system 块不参与计数,由调用方照旧常显。
 */
import type { CliTranscriptBlock } from "@kernel/cli";

export const SS_LIVE_WINDOW = 3;

export type SsLiveWindow = { head: CliTranscriptBlock[]; visible: CliTranscriptBlock[] };

export function splitLiveWindow(process: CliTranscriptBlock[]): SsLiveWindow {
  if (process.length <= SS_LIVE_WINDOW) return { head: [], visible: process };
  const head = process.slice(0, process.length - SS_LIVE_WINDOW);
  const visible = process.slice(process.length - SS_LIVE_WINDOW);
  if (visible.some((b) => b.role === "reasoning")) return { head, visible };
  /* 窗内无思考:换入 head 尾部最近的思考块,挤出窗内最老工具块(保持窗 = 3)。 */
  const thinkIdx = head.map((b) => b.role).lastIndexOf("reasoning");
  if (thinkIdx === -1) return { head, visible };
  const evicted = visible[0];
  return {
    head: [...head.slice(0, thinkIdx), ...head.slice(thinkIdx + 1), evicted],
    visible: [head[thinkIdx], ...visible.slice(1)],
  };
}
