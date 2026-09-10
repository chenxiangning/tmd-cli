/**
 * PTY 会话装配共用件 —— shell / ssh / CLI 三条 spawn 路径的「常驻订阅 + 竞态守卫」。
 *
 * 三路径同构(原各持一份拷贝):从会话诞生起持续订阅输出/退出(与幕布是否
 * 挂载无关),退出回调清场并广播 sessionExited。差异经 opts 注入:
 * CLI 路径的秒退守望经 onExit 钩子进入退出回调(须在 removeSession 清缓冲前摘尾)。
 *
 * 竞态守卫(双订阅 await 缝隙被 removeSession):成对退订 + 广播
 * sessionStartFailed(StartFailureToast 呈现)+ 显式返回 null。调用方按
 * spawn 被拒同款语义(广播 + 抛出)上抛 —— 绝不用非空断言把 undefined 说成
 * SessionMeta:断言说谎时下游 .id 访问即 TypeError,失败还无声。
 */

import { KernelTopics, type EventBus } from "./events";
import { onPtyExit, onPtyOutput, type SessionMeta } from "./ipc";

/** host 侧最小依赖面(三服务的 ctx 均满足;箭头函数惰性绑定避免构造顺序耦合)。 */
export interface SessionAdoptHost {
  findSession(sessionId: string): SessionMeta | undefined;
  appendOutput(sessionId: string, text: string): void;
  removeSession(sessionId: string): Promise<void>;
  /** 登记输出/退出退订对(会话移除时成对退订)。 */
  trackUnlisten(sessionId: string, offs: Array<() => void>): void;
  /** 活会话表(事件广播载荷)。 */
  getSessions(): SessionMeta[];
  /** 外壳重渲染通知(Host.notify)。 */
  notify(): void;
}

export interface AdoptPtySessionOptions {
  /** sessionStartFailed 载荷用(shell / ssh / 各 CLI profile id)。 */
  profileId: string;
  /** 退出回调前置钩子(CLI 秒退守望摘幕布尾部;shell/ssh 不传)。 */
  onExit?: (sessionId: string) => void;
  /** 缺省 true;false = 后台装配(不广播 activeSessionChanged,不抢中央区/tab)。 */
  activate?: boolean;
}

/** 守卫分支的广播文案(抛出信息与之一致,调用方直接复用)。 */
export const ADOPT_RACE_REASON = "会话在装配期间被移除(进程启动后即刻退出)";

/**
 * spawn 共用装配:常驻订阅输出与退出、竞态守卫、广播会话表。
 * 返回 null = 守卫分支命中(已广播 sessionStartFailed)。
 */
export async function adoptPtySession(
  h: SessionAdoptHost,
  events: EventBus,
  sessionId: string,
  opts: AdoptPtySessionOptions,
): Promise<SessionMeta | null> {
  /* 双订阅互不依赖,并行注册;缝隙竞态由下方存活复查统一兜底(退订恒成对)。 */
  const [offOutput, offExit] = await Promise.all([
    onPtyOutput(sessionId, (text) => {
      /* 存活守卫:退订前在途的迟到输出不得复活已删会话的缓冲/呼吸灯状态 */
      if (!h.findSession(sessionId)) return;
      h.appendOutput(sessionId, text);
    }),
    onPtyExit(sessionId, () => {
      /* 秒退守望等钩子须在 removeSession 清缓冲前同步执行 */
      opts.onExit?.(sessionId);
      void h.removeSession(sessionId);
      events.emit(KernelTopics.sessionExited, sessionId);
    }),
  ]);
  /* removeSession 插进两次订阅 await 之间 → 退订表查不到会漏退订:复查存活,
     已删则成对退订;会话既已不在,按启动失败广播(StartFailureToast 路径) */
  if (!h.findSession(sessionId)) {
    [offOutput, offExit].forEach((off) => off());
    events.emit(KernelTopics.sessionStartFailed, {
      sessionId,
      profileId: opts.profileId,
      reason: ADOPT_RACE_REASON,
    });
    return null;
  }
  h.trackUnlisten(sessionId, [offOutput, offExit]);
  events.emit(KernelTopics.sessionsChanged, h.getSessions());
  if (opts.activate !== false) events.emit(KernelTopics.activeSessionChanged, sessionId);
  h.notify();
  return h.findSession(sessionId) ?? null;
}
