/**
 * loading 按钮最短转圈时长 —— 数据再快也转满一圈。
 * animate-spin = 1s/圈;转不满一圈用户以为没点上、不跟手(2026-09-06 用户反馈)。
 * 消费方:git(panelStore 刷新转圈 / GitPanel 远端操作)、workspace(会话列表重扫)。
 */

/** 最短转圈毫秒数(一圈)。 */
const MIN_SPIN_MS = 1000;

/** 距 startedAt 还差多久转满一圈;已满返回 0(调用方据此同步收尾或 setTimeout)。 */
export function spinRemainder(startedAt: number): number {
  return Math.max(0, MIN_SPIN_MS - (Date.now() - startedAt));
}
