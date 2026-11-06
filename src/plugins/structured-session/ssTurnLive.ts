/**
 * 结算渲染宽限 hook —— 引擎代理循环逐步发 session_settled(2026-11-05 实锤:
 * 多步轮内折叠头抢在工具跑完前出现,过程区被提前折成「思考 N 次」组且
 * 工具行重复)。true 沿即时生效,false 沿 600ms trailing——步间间隙不闪
 * 「落定折叠」渲染;轮真结束(用户还能看满 600ms 收尾)才切折叠形态。
 */
import { useCallback, useEffect, useRef, useState } from "react";

const SETTLE_GRACE_MS = 600;

export function useTurnLive() {
  const [live, setLive] = useState(false);
  /* 轮起始时刻:轮首 begin 沿事件捕获(步间反复 begin 不重置,整轮连续计时)。 */
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const liveRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const stopTimer = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);
  /** 轮进行中(agent_start 边沿):即时切活轮渲染,取消在途宽限;
   *  起始时刻只在闲→活沿记一次(多步轮整轮连续)。 */
  const begin = useCallback(() => {
    stopTimer();
    if (!liveRef.current) setStartedAt(Date.now());
    liveRef.current = true;
    setLive(true);
  }, [stopTimer]);
  /** 结算边沿(session_settled):宽限后才切落定渲染;期间新 begin 即取消。 */
  const end = useCallback(() => {
    stopTimer();
    timerRef.current = window.setTimeout(() => {
      liveRef.current = false;
      setLive(false);
    }, SETTLE_GRACE_MS);
  }, [stopTimer]);
  /** 复位(重试/会话退出):立即落定并清宽限与起始时刻。 */
  const reset = useCallback(() => {
    stopTimer();
    liveRef.current = false;
    setLive(false);
    setStartedAt(null);
  }, [stopTimer]);
  useEffect(() => stopTimer, [stopTimer]);
  return { live, startedAt, begin, end, reset };
}
