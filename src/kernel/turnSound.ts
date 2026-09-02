/**
 * 轮次结束提示音 —— turnSettled 事件的消费端(与 askSound 平行的第二提示音)。
 *
 * 2s 静默 ≠ 会话结束:长思考/静默工具中途的轮次闪断,蓝灯可自愈(下次输出即清),
 * 声音不能"自愈"—— 响了就是响了。故结算后先挂 CONFIRM_DELAY_MS 延迟确认:
 * 窗口内用户点开(markViewed 清未读)或新输出推进时间戳 → 静默放弃;
 * 复查通过才播。会话移除同样自愈(onSessionRemoved 清未读,复查自然失败)。
 * 播放复用 askSound 的懒加载管线(playAskSound),零重复资产代码。
 */

import { KernelTopics, type EventBus, type TurnSettledEvent } from "./events";
import { getSettingsState } from "./settings";
import { playAskSound } from "./askSound";
import { host } from "./host";

/** 延迟确认窗口:结算后静默至此仍未被查看、无新输出,才认定"这轮真结束了"。 */
export const TURN_END_CONFIRM_MS = 3_000;

/** 计时器句柄:webview 运行时是 number,Node 测试环境是 Timeout;仅内部持有。 */
type TimerHandle = ReturnType<typeof setTimeout>;

/** 确认依赖(host 查询 + 播放);注入化仅为可测,生产默认绑 host 单例。 */
export interface TurnSoundDeps {
  isUnread(sessionId: string): boolean;
  getLastActivityAt(sessionId: string): number;
  play(soundId: unknown): void;
}

const defaultDeps: TurnSoundDeps = {
  isUnread: (id) => host.isUnread(id),
  getLastActivityAt: (id) => host.getLastActivityAt(id),
  play: (soundId) => playAskSound(soundId),
};

/** 每会话至多一个在途确认:后续结算覆盖前序(重置确认窗)。 */
const pendingConfirms = new Map<string, { settledAt: number; timer: TimerHandle }>();

/** 结算进站:未被查看才进入延迟确认;查看/新输出/移除都会让复查失败而静默。 */
export function observeTurnSettled(
  payload: TurnSettledEvent,
  deps: TurnSoundDeps = defaultDeps,
): void {
  const existing = pendingConfirms.get(payload.sessionId);
  if (existing) clearTimeout(existing.timer);
  if (!payload.unviewed) {
    pendingConfirms.delete(payload.sessionId);
    return;
  }
  const { turnEndSoundEnabled, turnEndSoundId } = getSettingsState().settings;
  if (!turnEndSoundEnabled) {
    pendingConfirms.delete(payload.sessionId);
    return;
  }
  const timer = setTimeout(() => {
    pendingConfirms.delete(payload.sessionId);
    /* 复查:仍为完成未读,且末次输出时刻与结算时一致(无新输出)才播 */
    if (!deps.isUnread(payload.sessionId)) return;
    if (deps.getLastActivityAt(payload.sessionId) !== payload.settledAt) return;
    deps.play(turnEndSoundId);
  }, TURN_END_CONFIRM_MS);
  pendingConfirms.set(payload.sessionId, { settledAt: payload.settledAt, timer });
}

/** 启动接线(main.tsx 调一次):订阅内核 turnSettled。 */
export function bootTurnSound(bus: EventBus, deps: TurnSoundDeps = defaultDeps): void {
  bus.on<TurnSettledEvent>(KernelTopics.turnSettled, (payload) =>
    observeTurnSettled(payload, deps),
  );
}
