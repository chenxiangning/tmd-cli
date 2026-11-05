/**
 * 轮次看门狗 hook(RPC 会话体系对齐批次 6)—— busy 且 >5min 无新帧 = 引擎
 * 疑似僵死,一次性 warn 提示。PTY 侧 render_health 阶梯的 RPC 对应物:
 * 传感器在前端帧沿(消费方每帧 stamp),不在引擎侧自报。
 */

import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";

/** busy 期静默超限 → setWarn(warnText,一次性 w ?? 兜底);返回帧戳 stamp。 */
export function useTurnWatchdog(
  busy: boolean,
  warnText: () => string,
  setWarn: Dispatch<SetStateAction<string | null>>,
  staleMs = 300_000,
): { stamp: () => void } {
  const lastAtRef = useRef(0);
  const notifiedRef = useRef(false);
  useEffect(() => {
    if (!busy) {
      lastAtRef.current = 0;
      notifiedRef.current = false;
      return;
    }
    lastAtRef.current = lastAtRef.current || Date.now();
    const id = window.setInterval(() => {
      if (Date.now() - lastAtRef.current > staleMs && !notifiedRef.current) {
        notifiedRef.current = true;
        setWarn((w) => w ?? warnText());
      }
    }, 5_000);
    return () => window.clearInterval(id);
  }, [busy, staleMs, setWarn, warnText]);
  return { stamp: () => (lastAtRef.current = Date.now()) };
}
