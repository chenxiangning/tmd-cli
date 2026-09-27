/**
 * omp select ask 卡结构化解析(2026-09-27 大仙报「面板无选项、只能识别一个问题」):
 * 从 PTY 尾流剥 ANSI 后识别卡结构,提取 当前问题正文 + 选项列表(序 = 数字键)
 * + 问题总数。omp 私有格式知识留插件侧(kernel 只持跨 CLI 等待检测原语)。
 *
 * 卡结构(幕布实测):
 *   ∞ <卡标题>              ← 非本题,忽略
 *   Ask
 *   <问题1>  <问题2>  Submit  ← tab 行:Submit 前词组数 = 问题总数
 *   <当前问题正文>
 *   ❯ ● <选项1>(选中)       ← ● 高亮 / ○ 空心;❯ 指针(总结态行如「❯ Submit」无 ●)
 *       <缩进描述行>         ← 选项说明,不进选项文本
 *     ○ <选项2>
 *   1. <问题>: <已选>       ← 总结态摘要行,忽略
 *   ← select · n note · …   ← 页脚
 *
 * 非 omp 卡(y/n 提问等)解析不出选项块 → null,面板回落 excerpt 展示。
 */

export interface AskCard {
  /** 当前焦点问题正文。 */
  question: string;
  /** 选项文本,数组序 +1 = 数字键。 */
  options: string[];
  /** 卡内问题总数(tab 行词组数;单问 = 1)。 */
  multi: number;
}

/** 选项行:● 高亮 / ○ 空心 + 文本。 */
const OPTION_RE = /^[●○•][ \t]+(.+)$/;
/** 指针行:❯/> 开头(❯ ● x 与总结态 ❯ Submit 都命中)。 */
const POINTER_RE = /^[❯>»]\s*(.*)$/;
/** tab 行:若干问题词组 + Submit 收尾。 */
const TABS_RE = /^(.+)\s+Submit$/;
/** 总结态摘要行:1. xxx: yyy。 */
const SUMMARY_RE = /^\d+\.\s/;

export function parseAskCard(text: string): AskCard | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l.trim().length > 0)
    .map((l) => l.trim());
  let tabIndex = -1;
  let multi = 1;
  for (let i = 0; i < lines.length; i++) {
    const m = TABS_RE.exec(lines[i]);
    if (m && m[1].trim() !== "") {
      tabIndex = i;
      multi = m[1].trim().split(/\s+/).filter((w) => w !== "Ask").length;
      break;
    }
  }
  /* 选项块:tab 行(或文首)之后首个 ●/○/指针行起,到页脚/结构行止;描述行跳过。 */
  const options: string[] = [];
  let blockStart = -1;
  for (let i = tabIndex + 1; i < lines.length; i++) {
    const t = lines[i];
    const opt = OPTION_RE.exec(t) ?? (POINTER_RE.test(t) ? POINTER_RE.exec(t) : null);
    if (!opt) continue;
    blockStart = i;
    for (let j = i; j < lines.length; j++) {
      const l = lines[j];
      if (l.startsWith("←")) break; /* 页脚:块终 */
      const o = OPTION_RE.exec(l);
      if (o) {
        options.push(o[1].trim());
        continue;
      }
      if (POINTER_RE.test(l)) {
        const inner = POINTER_RE.exec(l)![1].trim();
        const nested = OPTION_RE.exec(inner);
        options.push((nested ? nested[1] : inner).trim());
        continue;
      }
      /* 描述/摘要行:块内跳过 */
    }
    break;
  }
  /* 总结态卡只剩 Submit 单选项;正常选择卡 ≥2 项。 */
  const summarySubmit = options.length === 1 && options[0] === "Submit";
  if ((options.length < 2 && !summarySubmit) || blockStart < 0) return null;
  /* 问题正文:选项块上方最近非结构行(跳过摘要行/Ask/卡标题/tab 行)。 */
  let question = "";
  for (let i = blockStart - 1; i > tabIndex; i--) {
    const t = lines[i];
    if (t === "Ask" || t.startsWith("∞") || t.startsWith("←") || SUMMARY_RE.test(t)) continue;
    question = t;
    break;
  }
  if (!question) return null;
  return { question, options, multi: Math.max(1, multi) };
}
