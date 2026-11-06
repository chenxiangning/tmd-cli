/**
 * 轮时钟与轮末记账 hook(批次 F)—— busy/working 计时/OS 轮末通知/未读沿
 * 的唯一事实源:全部由 useTurnLive 宽限态派生。引擎多步轮逐步发
 * session_settled,原始 onBusy 边沿会中途弹通知、计时归零、未读虚高;
 * 宽限跌落(600ms 无新步)= 真轮末,恰一次通知。退出/重试路径先
 * clearDebt() 再 turnLive.reset(),防跌落沿误报。
 * 天花板:步间间隙 > 600ms 会被判假轮末(提前通知/未读,不双计);真轮
 * 末 debt 已清不补发 —— 引擎调度慢的场景如可见再调 SETTLE_GRACE_MS。
 * busy/busySince 为纯派生(live / startedAt),不拷贝进 state。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { notifyTurnEnd } from "./ssNotify";

interface TurnClockDeps {
  profileId: string;
  cwd: string;
}

export function useSsTurnClock(live: boolean, startedAt: number | null, payload: TurnClockDeps, scope: string, ledgerId: string) {
  const busy = live;
  const busySince = live ? startedAt : null;
  const [elapsed, setElapsed] = useState(0);
  /* 最后活跃时刻(行投影闲时相对时间):挂载即记,busy 双沿刷新。 */
  const [lastActiveAt, setLastActiveAt] = useState(() => Date.now());
  const promptDebtRef = useRef(0); // 用户在途轮计数:send 记账结算销账,只有用户轮结束才发 OS 通知

  const spend = useCallback(() => { promptDebtRef.current++; }, []);
  const refund = useCallback(() => {
    promptDebtRef.current = Math.max(0, promptDebtRef.current - 1);
  }, []);
  const clearDebt = useCallback(() => { promptDebtRef.current = 0; }, []);

  /* 真轮末通知:宽限跌落沿恰一次(多步轮步间 settled 不触发);退出/重试
   * 先 clearDebt 防误报。 */
  const prevLiveRef = useRef(false);
  useEffect(() => {
    const fell = prevLiveRef.current && !live;
    prevLiveRef.current = live;
    if (!fell || promptDebtRef.current <= 0) return;
    promptDebtRef.current--;
    notifyTurnEnd(payload.profileId, payload.cwd, scope, ledgerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  /* working 头计时(monocode「working for Ns」同语义):轮起跳,结算归零。 */
  useEffect(() => {
    if (busySince === null) return;
    const tick = () => setElapsed(Math.max(0, Math.round((Date.now() - busySince) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [busySince]);

  return { busy, busySince, elapsed, lastActiveAt, setLastActiveAt, spend, refund, clearDebt };
}
