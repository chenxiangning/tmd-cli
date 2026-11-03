import type { CliTranscriptBlock } from "@kernel/cli";
import { isWrapperText } from "../cli-shared/userMessages";

/** 最后一条可重试用户正文：控制命令、系统包装与接力外壳都不是新任务。 */
export function lastRetryablePrompt(blocks: readonly CliTranscriptBlock[]): string | null {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block.role !== "user") continue;
    const text = block.text.trim();
    if (!text || text.startsWith("/") || text.startsWith("接力自 ") || isWrapperText(text)) continue;
    return text;
  }
  return null;
}
