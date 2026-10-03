/**
 * 幕布数据链停滞探针(纯函数)—— 「PTY 在流而幕布不吃字节」形态的检出判据。
 *
 * 为什么存在(2026-10-04 十一轮):既有守望全盯「渲染死亡」(rAF 探针/壳侧
 * 心跳 → 阶梯击打),对「渲染活着、字节链断了」零覆盖 —— 订阅丢失/回放
 * Promise 悬死等形态下,rAF 照跳、React 照渲染,守望全线静默,幕布停在旧帧
 * 直到用户手点刷新钮。本判据补这条检出线:输出缓冲字节仍在推进(appendOutput
 * 主链活着)而本幕布(ptyLiveTopic 订阅)超过静默窗没收到任何字节 = 数据链
 * 停滞,自动重建幕布(canvasGen 自增 = 重订阅 + 缓冲回放),与渲染死亡阶梯
 * 互斥分工。
 *
 * 「在流」真相取缓冲字节变化而非 activity.lastActivityAt:后者未锚定会话
 * 不推进(会话从未用户写入 = 恒 0),缓冲字节数(O(1) 读,含压实回落)只要
 * appendOutput 在跑就会变 —— 锚无关、压实方向无关。
 *
 * 判据刻意保守(误重建 = 无谓的整幕回放):
 * - 仅激活幕布:隐藏幕布本就 250ms 合帧缓写,节奏不同源;
 * - 仅流就绪后:回放/遮罩期的攒队是编排,不是停滞;
 * - 全局渲染冻结(rAF 停跳)时退出:那是守望阶梯的领地,重建无意义
 *   (页面悬死时重建的订阅同样悬死),交给 reload 语义处理;
 * - PTY 静默(字节无变化)不判:没有「应到未到」的对照;
 * - 30s 重建冷却:一次重建未愈不再连环放大(重建本身含回放成本)。
 */

/** 幕布静默窗:订阅超过此时长未收到任何字节(而 PTY 字节仍在推进)= 停滞实锤。 */
export const STALL_CANVAS_SILENCE_MS = 6_000;
/** 全局渲染冻结线:rAF 间隙超过此值 = 页面级冻结,归守望阶梯,本探针退出。 */
export const STALL_RAF_DEAD_MS = 4_000;
/** 自愈重建冷却:防止重建未愈时的连环放大。 */
export const STALL_KICK_COOLDOWN_MS = 30_000;

/** 探针输入(由 TerminalView 2s 巡检采集)。 */
export interface CanvasStallInputs {
  now: number;
  /** 本幕布是否激活(仅激活幕布受检)。 */
  active: boolean;
  /** 流是否就绪(terminalReplay onReady;回放/遮罩期不检)。 */
  streamReady: boolean;
  /** PTY 侧自上拍以来仍在产出(输出缓冲字节数有变化;appendOutput 主链的锚无关真相)。 */
  outputGrew: boolean;
  /** 本幕布最近一次收到实时字节(ptyLiveTopic 订阅入口戳;0 = 从未收到)。 */
  lastLiveAt: number;
  /** 原生 rAF 间隙(rafFallback.nativeRafGapMs;页级渲染健康真源)。 */
  rafGapMs: number;
  /** 上次自愈重建时刻(0 = 未重建过)。 */
  lastKickAt: number;
}

/** 是否应触发幕布重建(canvasGen 自增)。 */
export function shouldRebuildCanvas(s: CanvasStallInputs): boolean {
  if (!s.active || !s.streamReady) return false;
  if (s.rafGapMs >= STALL_RAF_DEAD_MS) return false;
  if (s.lastKickAt !== 0 && s.now - s.lastKickAt < STALL_KICK_COOLDOWN_MS) return false;
  if (!s.outputGrew) return false;
  return s.now - s.lastLiveAt >= STALL_CANVAS_SILENCE_MS;
}
