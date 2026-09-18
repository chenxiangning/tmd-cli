/**
 * 标记锚点纯逻辑 —— 指纹、重定位、摘录。零 IO 零 React,编辑器扩展与面板共用。
 *
 * 0 容忍红线:标记永不写源文件;行号只是显示值,定位置信源是指纹。
 * 指纹双层(council oracle 加固):标记区逐行 hash 拼接防高频重复行(空行 /
 * import 行)误命中;上下文行(前一行 + 后一行)hash 仅作多候选收敛的辅助。
 */

export interface MarkFingerprint {
  /** 标记区逐行 hash 串(行内 `,` 连接)。 */
  body: string;
  /** 上下文行 hash:`前一行|后一行`,边界外为空串。 */
  context: string;
}

/** 待发送 → 已入对话(芯片条,发送随消息注入)→ 已发送;重定位:漂移 / 失联。 */
export type MarkState = "pending" | "staged" | "sent" | "drifted" | "lost";

export interface Mark {
  id: string;
  /** 绝对路径(sidecar 按工作区分文件;跨机器路径可能不同,失联语义兜底)。 */
  path: string;
  /** 1 基闭区间。 */
  startLine: number;
  endLine: number;
  fingerprint: MarkFingerprint;
  /** 落标时的摘录快照(发送语义:AI 看到的是标记当时的内容,后续文件改动不影响)。 */
  excerpt: string;
  note: string;
  state: MarkState;
  createdAt: number;
}

/** fnv-1a 32 位 hex —— 只求判等区分,不抗碰撞攻击。 */
export function lineHash(line: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < line.length; i++) {
    h ^= line.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function fingerprintRange(lines: readonly string[], startLine: number, endLine: number): MarkFingerprint {
  const body = lines
    .slice(startLine - 1, endLine)
    .map(lineHash)
    .join(",");
  const prev = startLine > 1 ? lineHash(lines[startLine - 2]) : "";
  const next = endLine < lines.length ? lineHash(lines[endLine]) : "";
  return { body, context: `${prev}|${next}` };
}

export interface RelocateResult {
  /** exact = 原位置未动;moved = 已重定位;lost = 窗口内无命中(绝不瞎指)。 */
  status: "exact" | "moved" | "lost";
  startLine: number;
  endLine: number;
}

/**
 * ±window 行窗口内重定位。原位置 body 全等 = exact;窗口内唯一 body 命中 =
 * moved(多候选时 context 收敛,仍多候选取第一个 —— 上下文相同的多份重复代码
 * 本就不可分辨);无命中 = lost。
 */
export function relocateMark(lines: readonly string[], mark: Mark, window: number): RelocateResult {
  const height = mark.endLine - mark.startLine + 1;
  const bodyAt = (startLine: number): string | null => {
    const endLine = startLine + height - 1;
    if (startLine < 1 || endLine > lines.length) return null;
    return fingerprintRange(lines, startLine, endLine).body;
  };
  if (bodyAt(mark.startLine) === mark.fingerprint.body) {
    return { status: "exact", startLine: mark.startLine, endLine: mark.endLine };
  }
  const candidates: number[] = [];
  for (let offset = 1; offset <= window; offset++) {
    for (const start of [mark.startLine - offset, mark.startLine + offset]) {
      if (bodyAt(start) === mark.fingerprint.body) candidates.push(start);
    }
  }
  const matched = candidates.find(
    (start) => fingerprintRange(lines, start, start + height - 1).context === mark.fingerprint.context,
  ) ?? candidates[0];
  if (matched === undefined) {
    return { status: "lost", startLine: mark.startLine, endLine: mark.endLine };
  }
  return { status: "moved", startLine: matched, endLine: matched + height - 1 };
}

/** 标记区摘录(面板卡与发送序列化共用):前 max 行,超出追加省略行号提示。 */
export function markExcerpt(lines: readonly string[], startLine: number, endLine: number, max = 3): string {
  const slice = lines.slice(startLine - 1, endLine);
  const head = slice.slice(0, max).join("\n");
  return slice.length > max ? `${head}\n… 共 ${slice.length} 行` : head;
}
