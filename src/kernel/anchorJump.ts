/**
 * 锚点定位与跳转逻辑 —— 自 messageAnchors.ts 拆出(文件规模铁则收紧至 300 行)。
 * 承担:needle 提取、buffer 行匹配、点击跳转(翻页重试)、平滑滚动、active 锚点追踪、
 * 文本跳转契约(jumpToText / openThenJumpToText,checkpoint↔转录互跳与检索增强共用)。
 * 纯逻辑,fake TerminalHandle 可测;handle 注册表在 terminalHandles.ts。
 */

import { host } from "./host";
import { getTerminalHandle, subscribeTerminalRegistry, type TerminalHandle } from "./terminalHandles";
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

/** 任意文本 → 幕布匹配 needle:剥 @token、折叠空白、取首行首 24 字符。 */
export function textNeedle(text: string): string {
  const firstLine = text.split("\n").find((l) => l.trim()) ?? "";
  const stripped = firstLine.replace(ATTACH_TOKEN_RE, " ").replace(/\s+/g, " ").trim();
  /* 纯附件消息剥空后回退原文首行,仍有机会命中气泡里的残留文本 */
  const source = stripped || firstLine.replace(/\s+/g, " ").trim();
  return source.slice(0, NEEDLE_LENGTHS[0]);
}

/** 消息文本 → 幕布匹配 needle(同一归一管线;锚点对象按引用缓存)。 */
export function anchorNeedle(anchor: UserMessageAnchor): string {
  const cached = needleCache.get(anchor);
  if (cached !== undefined) return cached;
  const needle = textNeedle(anchor.text);
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
  return jumpScanPages(handle, needle, 0);
}

/** 逐页向后扫描(递归替代轮询循环;深度 = JUMP_PAGE_LIMIT 上界)。 */
async function jumpScanPages(
  handle: TerminalHandle,
  needle: string,
  page: number,
): Promise<boolean> {
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
  return jumpScanPages(handle, needle, page + 1);
}

/* ── 文本跳转契约(checkpoint↔转录互跳;候选5检索增强同款消费)────────── */

/** 跳转结果:jumped = 幕布已定位;opened = 会话已打开但文本未命中;miss = 未打开/未定位。 */
export type JumpTextOutcome = "jumped" | "opened" | "miss";

/** 磁盘恢复目标:账本/检索侧持有的寻址凭证(内核不理解其语义,只透传)。 */
export interface DiskJumpTarget {
  profileId: string;
  cwd: string;
  workspaceId?: string;
  cliSessionId: string;
}

/** 打开会话后等幕布 handle 注册的默认上限(冷启动 spawn + 首帧挂载的富余)。 */
const OPEN_JUMP_TIMEOUT_MS = 8000;

/** 文本跳转(活会话):幕布定位;无 handle 或 needle 未命中返回 false。 */
export async function jumpToText(sessionId: string, text: string): Promise<boolean> {
  const handle = getTerminalHandle(sessionId);
  if (!handle) return false;
  return jumpScanPages(handle, textNeedle(text), 0);
}

/** 账本/检索身份 → 活会话:按 tmd id 或绑定 cli 身份反查(resume 换壳后 tmd id 已变)。 */
function findLiveSessionId(cliSessionId: string): string | null {
  const live = host
    .getSessions()
    .find((s) => s.id === cliSessionId || host.getCliSessionId(s.id) === cliSessionId);
  return live?.id ?? null;
}

/** 等幕布 handle 注册(打开会话 → TerminalView 挂载注册;超时放弃)。 */
async function waitForTerminalHandle(
  sessionId: string,
  timeoutMs: number,
): Promise<TerminalHandle | undefined> {
  const immediate = getTerminalHandle(sessionId);
  if (immediate) return immediate;
  /* 订阅注册表变更(挂载即广播),零轮询;超时兜底放弃。 */
  const { promise, resolve } = Promise.withResolvers<TerminalHandle | undefined>();
  const settle = (h: TerminalHandle | undefined) => {
    off();
    window.clearTimeout(timer);
    resolve(h);
  };
  const off = subscribeTerminalRegistry(() => {
    const h = getTerminalHandle(sessionId);
    if (h) settle(h);
  });
  const timer = window.setTimeout(() => settle(undefined), timeoutMs);
  return promise;
}

/**
 * 共用时序桥:活会话直接跳;已关会话经 openDiskSession 恢复、等幕布挂载后再跳。
 * jumped = 已定位(两路同义,调用方无需提示);opened = 会话已打开但 needle 未
 * 命中(调用方提示可手动查找);miss = 打开失败 / handle 超时 / 活会话未命中。
 */
export async function openThenJumpToText(
  target: DiskJumpTarget,
  text: string,
  opts?: { timeoutMs?: number },
): Promise<JumpTextOutcome> {
  const liveId = findLiveSessionId(target.cliSessionId);
  if (liveId) return (await jumpToText(liveId, text)) ? "jumped" : "miss";
  const needle = textNeedle(text);
  try {
    const meta = await host.openDiskSession(
      target.profileId,
      target.cwd,
      target.workspaceId,
      target.cliSessionId,
    );
    const handle = await waitForTerminalHandle(meta.id, opts?.timeoutMs ?? OPEN_JUMP_TIMEOUT_MS);
    if (!handle) return "miss";
    return (await jumpScanPages(handle, needle, 0)) ? "jumped" : "opened";
  } catch {
    return "miss";
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
