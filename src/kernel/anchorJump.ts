/**
 * 锚点定位与跳转逻辑 —— 自 messageAnchors.ts 拆出(文件规模铁则收紧至 300 行)。
 * 承担:needle 提取、buffer 行匹配、点击跳转(翻页重试)、平滑滚动、active 锚点追踪。
 * 纯逻辑,fake TerminalHandle 可测;handle 注册表在 terminalHandles.ts。
 */

import { getTerminalHandle, type TerminalHandle } from "./terminalHandles";
import type { UserMessageAnchor } from "./messageAnchors";

/** composer 注入的附件引用 token(@path),幕布气泡里不显示原文,匹配前剥掉。 */
const ATTACH_TOKEN_RE = /@[^\s@]+/g;
/** needle 长度梯队:长 needle 防误配,逐级退化防气泡截断/重排。 */
const NEEDLE_LENGTHS = [24, 14, 8] as const;
/** 跳转留头比例(对齐 codemoss:目标滚到视口 28% 处)。 */
const JUMP_HEADROOM = 0.28;
/** active 参考线:视口顶 + min(6 行, 32%),对齐 codemoss 的 min(96px, 32%)。 */
const ACTIVE_REF_MAX_ROWS = 6;
const ACTIVE_REF_RATIO = 0.32;
/** 向上找 active 锚点的行数上限:稀疏会话防长遍历,找不到保持原 active。 */
const ACTIVE_WALK_LIMIT = 4000;
/** 跳转翻页上限:12 页 × 512KB = 6MB 历史,超出判定消息不可达。 */
const JUMP_PAGE_LIMIT = 12;

const needleCache = new WeakMap<UserMessageAnchor, string>();

/** 消息文本 → 幕布匹配 needle:剥 @token、折叠空白、取首行首 24 字符。 */
export function anchorNeedle(anchor: UserMessageAnchor): string {
  const cached = needleCache.get(anchor);
  if (cached !== undefined) return cached;
  const firstLine = anchor.text.split("\n").find((l) => l.trim()) ?? "";
  const stripped = firstLine.replace(ATTACH_TOKEN_RE, " ").replace(/\s+/g, " ").trim();
  /* 纯附件消息剥空后回退原文首行,仍有机会命中气泡里的残留文本 */
  const source = stripped || firstLine.replace(/\s+/g, " ").trim();
  const needle = source.slice(0, NEEDLE_LENGTHS[0]);
  needleCache.set(anchor, needle);
  return needle;
}

function normalizeLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** 自底向上找 needle 所在行;长 needle 不命中逐级退化到 8 字符。 */
export function findAnchorRow(handle: TerminalHandle, needle: string): number | null {
  if (!needle) return null;
  for (const len of NEEDLE_LENGTHS) {
    const n = needle.slice(0, len);
    if (!n) continue;
    for (let row = handle.bufferLength() - 1; row >= 0; row--) {
      if (normalizeLine(handle.lineText(row)).includes(n)) return row;
    }
  }
  return null;
}

/** 点击跳转:buffer 定位 → 28% 留头;消息太老不在 buffer 时逐页加载更早历史再试。 */
export async function jumpToAnchor(
  sessionId: string,
  anchor: UserMessageAnchor,
): Promise<boolean> {
  const handle = getTerminalHandle(sessionId);
  if (!handle) return false;
  const needle = anchorNeedle(anchor);
  for (let page = 0; ; page++) {
    const row = findAnchorRow(handle, needle);
    if (row !== null) {
      await smoothScrollToLine(handle, Math.max(0, row - Math.round(handle.rows() * JUMP_HEADROOM)));
      return true;
    }
    if (page >= JUMP_PAGE_LIMIT || !handle.hasMoreHistory()) return false;
    const before = handle.bufferLength();
    await handle.loadEarlier();
    /* 翻页无进展(加载中重入/日志读空)即放弃,防空转 */
    if (handle.bufferLength() === before) return false;
  }
}

/* ── 平滑滚动 ────────────────────────────────────────────── */

/** 跳转动画时长;短距离缩短,避免小幅跳转也拖满全程。 */
const SMOOTH_SCROLL_MAX_MS = 260;
/* node 测试环境无 rAF,退 16ms 定时器;行为等价。 */
const raf: (cb: (now: number) => void) => void =
  globalThis.requestAnimationFrame ??
  ((cb) => void setTimeout(() => cb(performance.now()), 16));

/**
 * ease-out 动画滚动到目标行:xterm scrollToLine 本身瞬移,
 * 逐帧插值 viewportTop → target,视觉上跟手不跳变。
 * 用户中途滚轮/新跳转进来时让位(最新一帧赢)。
 */
let smoothScrollToken = 0;

/**
 * 返回的 promise 在动画落位后 resolve:测试可确定性断言落点,
 * UI 调用方 fire-and-forget 不阻塞。
 */
function smoothScrollToLine(handle: TerminalHandle, target: number): Promise<void> {
  const token = ++smoothScrollToken;
  const start = handle.viewportTop();
  const distance = target - start;
  if (Math.abs(distance) <= 2) {
    handle.scrollToLine(target);
    return Promise.resolve();
  }
  const duration = Math.min(SMOOTH_SCROLL_MAX_MS, 80 + Math.abs(distance) * 1.2);
  const t0 = performance.now();
  const { promise, resolve } = Promise.withResolvers<void>();
  const step = (now: number) => {
    if (token !== smoothScrollToken) return resolve();
    const p = Math.min(1, (now - t0) / duration);
    const eased = 1 - (1 - p) ** 3;
    handle.scrollToLine(Math.round(start + distance * eased));
    if (p < 1) raf(step);
    else resolve();
  };
  raf(step);
  return promise;
}

/**
 * 滚动 active 追踪:视口参考线向上找最近一条锚点所在行。
 * 等价 codemoss 的"参考线取最近用户消息",但数据源从 DOM rect 换成 buffer 行文本。
 */
export function resolveActiveAnchorId(
  handle: TerminalHandle,
  anchors: readonly UserMessageAnchor[],
): string | null {
  if (anchors.length === 0) return null;
  const needles = anchors.map((a) => ({ id: a.id, needle: anchorNeedle(a) }));
  const top = handle.viewportTop();
  const ref = top + Math.min(ACTIVE_REF_MAX_ROWS, Math.round(handle.rows() * ACTIVE_REF_RATIO));
  const floor = Math.max(0, ref - ACTIVE_WALK_LIMIT);
  for (let row = Math.min(ref, handle.bufferLength() - 1); row >= floor; row--) {
    const line = normalizeLine(handle.lineText(row));
    if (!line) continue;
    for (const { id, needle } of needles) {
      if (needle && line.includes(needle)) return id;
    }
  }
  return null;
}
