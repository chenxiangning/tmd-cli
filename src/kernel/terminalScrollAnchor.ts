/**
 * 幕布滚动位内容锚定纯函数(terminalScrollKeeper 拆分,300 行铁则)。
 * 锚文 = 视口顶起首个非空行的 24 字符归一子串;重排后按就近扫描(第一段)/
 * 全缓冲扫描(重印重锚)回找锚行。
 */

/** 最小行访问面(真 Terminal 结构子集)。 */
export interface ScrollLine {
  translateToString(trimRight?: boolean): string;
}

/** 锚定读取面:与 ScrollableTerm 的 buffer.active 域结构同构(不回 import 保单向)。 */
interface AnchorBuffer {
  readonly length?: number;
  getLine?(row: number): ScrollLine | undefined;
}

const ANCHOR_WALK = 8; /* 锚行:视口顶起向下找首个非空行的容忍(仍在视口内) */
const ANCHOR_CHARS = 24; /* 锚文本长度(对齐 anchorJump needle 上限) */
const ANCHOR_SCAN = 150; /* 第一段估计点就近扫描半径;超出退回索引保持 */

const norm = (s: string): string => s.replace(/\s+/g, " ").trim();

export function anchorText(
  term: { buffer: { active: AnchorBuffer } },
  from: number,
): string | null {
  for (let i = 0; i < ANCHOR_WALK; i++) {
    const s = norm(term.buffer.active.getLine?.(from + i)?.translateToString(true) ?? "");
    if (s) return s.slice(0, ANCHOR_CHARS);
  }
  return null;
}

/** 就近扫描:自 from 向外找含锚文本的行(锚行可能是折行续段,用子串匹配)。 */
export function findAnchor(b: AnchorBuffer, anchor: string, from: number): number {
  /* 行文本读取收敛单点:探测循环每次取不同行,非重复查表 */
  const lineAt = (row: number): string =>
    norm(b.getLine?.(row)?.translateToString(true) ?? "");
  for (let d = 0; d <= ANCHOR_SCAN; d++) {
    // react-doctor-disable-next-line react-doctor/js-set-map-lookups -- 行缓冲就近探测,每行至多取一次,无重复查表可消
    if (lineAt(from + d).includes(anchor)) return from + d;
    // react-doctor-disable-next-line react-doctor/js-set-map-lookups -- 同上反向臂
    if (d > 0 && lineAt(from - d).includes(anchor)) return from - d;
  }
  return -1;
}

/** 全缓冲扫描(重印重锚用):重印从 transcript 顶重建,锚可落在任意处。
 *  自底向上取末次现行:TUI 反复重印同一锚文(提示符/表头帧)时末次才是最新位,
 *  取首现行会锚到偏高的旧帧(0.4.2 发版评审 P3 留观收编)。 */
export function findAnchorFull(b: AnchorBuffer, anchor: string): number {
  const len = b.length ?? 0;
  for (let row = len - 1; row >= 0; row--) {
    // react-doctor-disable-next-line react-doctor/js-set-map-lookups -- 全缓冲单遍扫描,每行至多取一次
    if (norm(b.getLine?.(row)?.translateToString(true) ?? "").includes(anchor)) return row;
  }
  return -1;
}
