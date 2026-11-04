/**
 * 活轮起点裁决(纯函数):live(轮进行中)= 最后一个用户块下标 —— 引擎轮界帧
 * (turn_start/session_settled)在代理多步循环里逐步推进,按 turnStart 切界
 * 会把在途过程错落成已定折叠组且工具行重复(2026-11-05 实锤);用户轮界才
 * 是渲染界。落定 = turnStart(结算后即全量落定)。无用户块回退 turnStart。
 */
import type { CliTranscriptBlock } from "@kernel/cli";

export function liveFromIndex(blocks: CliTranscriptBlock[], turnStart: number, live: boolean): number {
  if (!live) return turnStart;
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    if (blocks[i].role === "user") return i;
  }
  return turnStart;
}
