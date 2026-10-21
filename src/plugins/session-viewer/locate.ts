/**
 * 转录查看器行级定位(0.4.2 批一追加):幕布跳转(anchorJump)找不到的消息
 * 落查看器兜底 —— 查看器读磁盘全量转录,命中率高于幕布回放窗。
 * 匹配面 = user 块(kernel 深链 SessionViewLocate.text 作 needle,锚点跳转
 * 同款 24/14/8 梯队 + occurrence 同文定位);本文件纯函数,供单测。
 */
import type { CliTranscriptBlock } from "@kernel/cli";

/** 任意文本 → 匹配基准:剥 @token、折叠空白(anchorJump 同管线;组合公式不
 *  内联,两处消费需同律)。 */
function normalize(text: string): string {
  return text.replace(/@[^\s@]+/g, " ").replace(/\s+/g, " ").trim();
}

/** needle 长度梯队:长 needle 防误配,命中不足逐级退化防截断/重排。 */
const NEEDLE_LENGTHS = [24, 14, 8] as const;

/** blocks 里第 occurrence 个含 needle 的 user 块下标(0-based);找不到 = null。
 *  工作过程折叠组不参与(定位面 = 用户原话,与幂布锚点同域)。 */
export function findBlockIndex(blocks: readonly CliTranscriptBlock[], text: string, occurrence = 1): number | null {
  const flat = normalize(text);
  for (const len of NEEDLE_LENGTHS) {
    const needle = flat.slice(0, len);
    if (!needle) continue;
    let seen = 0;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.role !== "user" || !b.text) continue;
      if (normalize(b.text).includes(needle)) {
        seen += 1;
        if (seen === occurrence) return i;
      }
    }
  }
  return null;
}
