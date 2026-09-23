/**
 * 手机实况区文本装配 —— PTY 字节是线性累积,而全屏 TUI(引擎 picker/启动屏)
 * 逐帧重绘:纯文本视图里每帧都追加 = 大量重复垃圾(真机实证)。以「最后一次
 * 清屏/主备屏切换序列」为帧界只渲染当前帧;线性输出(无清屏)保持原尾窗语义。
 * 另:私有前缀 CSI(如 \x1b[>4;2m)普通 [0-9;]* 吃不掉,会漏到屏上 —— 一并剥净。
 */
import { collapseTui } from "@kernel/transcript";

/** 原始缓冲上限:帧切割只需尾部上下文,线性输出也照旧截尾。 */
const RAW_CAP = 256 * 1024;

/** 帧界序列:清屏(ESC[2J / ESC[3J)与主备屏切换(ESC[?1049h/l)。 */
const FRAME_CUT = /\x1b\[(?:2|3)J|\x1b\[\?1049[hl]/g;

/** ANSI CSI 全形:参数区允许私有前缀(:;<=>?),中间字节 [ -/],终字 [@-~]。 */
const CSI = /\x1b\[[0-9:;<=>?]*[ -/]*[@-~]/g;

/** OSC(窗口标题等):ESC ] … BEL 或 ESC \ 。 */
const OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

/** 剥 ANSI/控制序列(含私有前缀 CSI 与 OSC);裸控制字节一并去掉。 */
export function stripLive(s: string): string {
  // eslint-disable-next-line no-control-regex -- ANSI 序列本就是控制字节
  return s
    .replace(OSC, "")
    .replace(CSI, "")
    .replace(/[\x00-\x08\x0b-\x1a\x1c-\x1f]/g, "");
}

/** 追加原始字节并截尾(入缓冲;渲染统一走 renderLive)。 */
export function appendLive(raw: string, chunk: string): string {
  return (raw + chunk).slice(-RAW_CAP);
}

/** 原始字节 → 展示文本:切到最后一帧,剥序列,collapseTui 收敛,再截尾窗。 */
export function renderLive(raw: string, tailLines: number): string {
  let last = -1;
  for (const m of raw.matchAll(FRAME_CUT)) last = (m.index ?? 0) + m[0].length;
  const frame = last >= 0 ? raw.slice(last) : raw;
  return collapseTui(stripLive(frame))
    .split("\n")
    .slice(-tailLines)
    .join("\n");
}
