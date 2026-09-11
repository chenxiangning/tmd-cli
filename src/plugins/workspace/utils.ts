import { shortId } from "@kernel/sessionTitles";
import type { SessionMeta } from "@kernel/ipc";

/** 0 配额组「更多...」首击的展开步长(正配额组从配额值起翻倍:quota → 2× → 4×)。 */
export const PAGE_INITIAL = 10;

/** 新建会话菜单定位:以点击点为左上,按估算尺寸在视口内夹取(codemoss 同款)。
 *  供 SessionMenu/SessionContextMenu 与 index.tsx 的 ⌘T 入口共用。 */
export function clampMenuPosition(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.min(x, window.innerWidth - 328 - 12),
    y: Math.min(y, window.innerHeight - 420 - 12),
  };
}

/**
 * 活会话列表比较器:完成未读置顶,其余按 spawn 时间倒序。
 * 排序键必须是稳定身份(createdAt),绝不能用 lastActivityAt —— 它随每个输出
 * chunk 变化,做排序键会让同时流式输出的会话行位置反复互换(列表抖动事故根因)。
 * createdAt 缺失按 0;同毫秒 tie-break 用 id,保证跨渲染确定性。
 */
export function compareLiveSessions(
  a: SessionMeta,
  b: SessionMeta,
  isUnread: (id: string) => boolean,
): number {
  const ua = isUnread(a.id) ? 0 : 1;
  const ub = isUnread(b.id) ? 0 : 1;
  if (ua !== ub) return ua - ub;
  return (b.createdAt ?? 0) - (a.createdAt ?? 0) || b.id.localeCompare(a.id);
}

/**
 * 置顶快照有效性:短码垃圾(历史缺陷把 shortId 当快照持久化)视为无快照。
 * 判定用精确等值 —— 垃圾快照正是 shortId(cliSessionId) 的产物,不做模式猜测。
 */
export function realPinSnapshot(
  snapshot: string,
  cliSessionId: string,
): string | undefined {
  return snapshot && snapshot !== shortId(cliSessionId) ? snapshot : undefined;
}

/**
 * 行标题兜底链末端:命名/磁盘/快照解析结果为空时回短码(无磁盘身份的
 * 活会话回 fallbackId 短码)。三处消费(分组 hook / 运行区 / 全局置顶)
 * 需锁步行为,共用防「命名 > 磁盘 > 短码」口径漂移。
 */
export function orShortId(
  title: string | undefined,
  cliSessionId: string | undefined,
  fallbackId: string,
): string {
  return title ?? shortId(cliSessionId ?? fallbackId);
}

/**
 * 运行区候选判定(侧栏「运行区」自动聚集口径,工作区分组离组过滤共用此源,
 * 保证一个会话同一时刻只落在一个区域):
 * - turnActive(对话轮次进行中)在区:输出 2s 静默窗内,含「静默已过、
 *   1Hz 结算轮询未落账」的待决窗 —— activeTurns 恰在结算通知瞬间出站,
 *   成员资格与通知同界,免 Date.now() 跨渲染竞态;
 * - unread(结束未查看)在区;点开查看即出区回工作区分组;
 * - 二者皆否(已查看/从未对话)不在区。
 * 运行区侧另叠加置顶(任一作用域优先,置顶不进区)与归档(全域隐藏)排除,
 * 见 RunningZone.tsx;分组侧置顶本就离组或留组顶块,无需重复排除。
 */
export function isRunningZoneCandidate(turnActive: boolean, unread: boolean): boolean {
  return turnActive || unread;
}

/**
 * 活会话状态(内核 activityWatch 口径;首写闸:用户首写前的输出不算对话,
 * lastActivityAt 保持 0):
 * - running:对话进行中 —— turnActive(轮次在途,含思考期 spinner 静默)或
 *   2s 内有输出(与活动时间窗同阈值)
 * - unread:会话结束且未查看(完成未读)
 * - viewed:会话结束且已查看
 * - none:从未对话 —— 不亮灯、不出 label
 * 优先级:进行中压过未读(新输出即清未读,双保险);turnActive 压过活动钟
 * 出窗(空闲重绘闸冻结活动钟时,标签不得提前翻「会话结束」,2026-09-11 P0)。
 */
export type SessionStatus = "running" | "unread" | "viewed" | "none";

export function resolveSessionStatus(
  lastActivityAt: number,
  unread: boolean,
  now: number,
  turnActive: boolean,
): SessionStatus {
  if (lastActivityAt === 0) return "none";
  if (turnActive || now - lastActivityAt < 2000) return "running";
  if (unread) return "unread";
  return "viewed";
}

/**
 * 自动命名补扫节奏(三处锁步:分组 hook / 运行区 / 全局置顶):omp/claude 等
 * AI 标题晚于会话文件出生数秒~数十秒才落盘(omp 实证懒落盘晚 spawn 35-44s,
 * 命名生成更晚),单次 3s 补扫常扑空 —— 3s 起步指数退避至 24s 封顶,8 次后
 * 放弃(共 ~2.4min);永不命名的 CLI(codex/qoder)到次数学止,不永续轮询。
 */
export const TITLE_RESOLVE_MAX_ATTEMPTS = 8;

/** 第 attempt 次(1 起)补扫前的等待毫秒:3s → 6s → 12s → 24s 封顶。 */
export function titleRetryDelay(attempt: number): number {
  return Math.min(3_000 * 2 ** (attempt - 1), 24_000);
}
