/**
 * 轮次看门狗 hook(RPC 会话体系对齐批次 6)—— busy 且 >5min 无新帧 = 引擎
 * 疑似僵死,一次性 warn 提示。PTY 侧 render_health 阶梯的 RPC 对应物:
 * 传感器在前端帧沿(消费方每帧 stamp),不在引擎侧自报。
 */

import { useEffect, useRef } from "react";

/** busy 期静默超限 → addWarn(warnText,一次性去重);返回帧戳 stamp。
 *  warnText 为纯字符串(非内联闭包):busy 流式期每 120ms 重渲染不得
 *  令 effect 依赖抖动重启 interval(2026-11-05 评审 P3 修复)。 */
export function useTurnWatchdog(
  busy: boolean,
  warnText: string,
  addWarn: (text: string) => void,
  staleMs = 300_000,
): { stamp: () => void } {
  const lastAtRef = useRef(0);
  const notifiedRef = useRef(false);
  const addWarnRef = useRef(addWarn);
  useEffect(() => {
    addWarnRef.current = addWarn;
  });
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
        addWarnRef.current(warnText);
      }
    }, 5_000);
    return () => window.clearInterval(id);
  }, [busy, staleMs, warnText]);
  return { stamp: () => (lastAtRef.current = Date.now()) };
}
