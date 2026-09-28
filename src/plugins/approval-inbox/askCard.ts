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
  /** 选项文本,数组序 +1 = 数字键(select 卡)/ 序即光标目标项(multi 卡)。 */
  options: string[];
  /** 卡内问题总数(tab 行词组数;单问 = 1)。 */
  multi: number;
  /** 交互语义:select = 数字直选;multi = 空格 toggle + ⇥ 跳题(页脚 toggle 字样判定)。 */
  kind: "select" | "multi";
  /** CLI 光标所在选项下标(❯/▶ 行;面板代操作的移动基准)。 */
  cursor: number;
  /** tab 行词组全序(含 Submit 尾项;无 tab 行 = [题名?]):逐题识别与跳题数学的基准。 */
  tabs: string[];
  /** 面板跟踪的当前题下标(CLI 聚焦题;解析帧恒 0 基准,面板态在 UI 层推进)。 */
  tabActive: number;
}

/** 选项行:● 高亮 / ○ 空心 / ☒ 勾 ☐ 空(multi 卡)+ 文本。 */
const OPTION_RE = /^[●○•☒☐][ \t]+(.+)$/;
/** 指针行:❯/> 开头(❯ ● x 与总结态 ❯ Submit 都命中)。 */
const POINTER_RE = /^[❯>»]\s*(.*)$/;
/** tab 行:若干问题词组 + Submit 收尾。 */
const TABS_RE = /^(.+)\s+Submit$/;
/** 总结态摘要行:1. xxx: yyy。 */
const SUMMARY_RE = /^\d+\.\s/;
/** multi 卡页脚特征:toggle 键提示(select 卡无)。 */
const MULTI_FOOTER_RE = /\btoggle\b/;

/** 帧标题行:面板每帧重绘以「Ask」/「Ask (Ns)」起头;尾流含多帧时旧帧在前。 */
const FRAME_TITLE_RE = /^Ask( \(\d+s\))?$/;

export function parseAskCard(text: string): AskCard | null {
  const all = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l.trim().length > 0)
    .map((l) => l.trim());
  /* 多帧尾流只取最后一帧:光标寻址重绘把旧帧(上一题的选项块)留在尾里,
     整尾解析会命中旧帧的 question/选项(2026-09-27 真机滞后根因)。 */
  let frameStart = 0;
  for (let i = all.length - 1; i >= 0; i--) {
    if (FRAME_TITLE_RE.test(all[i])) {
      frameStart = i;
      break;
    }
  }
  const lines = all.slice(frameStart);
  let tabIndex = -1;
  let multi = 1;
  for (let i = 0; i < lines.length; i++) {
    const m = TABS_RE.exec(lines[i]);
    if (m && m[1].trim() !== "") {
      tabIndex = i;
      /* tab 行按 ≥2 空格切分(omp 渲染分隔,真机夹具实证):问题标题可含
         单个空格,按单词切会虚增题数、pills 裂词(2026-09-28 三轮 R3-AB-03)。 */
      multi = m[1].trim().split(/ {2,}/).filter((w) => w !== "Ask").length;
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
  /* tab 序:tab 行词组全列(含 Submit 尾);无 tab 行 = 单题无跳题面。 */
  let tabs: string[] = [];
  if (tabIndex >= 0) {
    const m = TABS_RE.exec(lines[tabIndex])!;
    tabs = m[1].trim().split(/ {2,}/).filter((w) => w !== "Ask");
    tabs.push("Submit");
  }
  /* 光标项:指针行在选项块内的序;无显式指针 = 首项(omp 默认停首)。 */
  let cursor = 0;
  for (let i = blockStart; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith("←")) break;
    if (POINTER_RE.test(l)) {
      cursor = options.findIndex((o) => {
        const inner = POINTER_RE.exec(l)![1].trim();
        const nested = OPTION_RE.exec(inner);
        return (nested ? nested[1] : inner).trim() === o;
      });
      if (cursor < 0) cursor = 0;
      break;
    }
  }
  const footer = lines.find((l) => l.startsWith("←") || l.startsWith("└")) ?? "";
  const kind: "select" | "multi" = MULTI_FOOTER_RE.test(footer) ? "multi" : "select";
  return { question, options, multi: Math.max(1, multi), kind, cursor, tabs, tabActive: 0 };
}

/** multi 卡把光标从 from 移到 target 的方向键序列(omp:↑/↓ move)。 */
export function moveKeys(from: number, target: number): string {
  if (target === from) return "";
  return target > from ? "\x1b[B".repeat(target - from) : "\x1b[A".repeat(from - target);
}

/** 跳题序列:从当前 tab 前进 k 次到达 target tab(⇥ 循环,不回绕)。 */
export function jumpTabKeys(current: number, target: number, total: number): string {
  if (total <= 0 || current === target) return "";
  return "\t".repeat((target - current + total) % total);
}
