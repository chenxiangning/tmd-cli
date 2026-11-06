/**
 * 轮次看门狗 hook(RPC 会话体系对齐批次 6;B2-1 升级)—— busy 且 >5min
 * 无新帧 = 引擎疑似僵死,暴露常驻 stale 态(非一次性 warn):新帧 stamp 即
 * 消隐,出口(重试/中断)由消费方 sessionTab 的常驻横幅呈现。PTY 侧
 * render_health 阶梯的 RPC 对应物:传感器在前端帧沿(消费方每帧 stamp),
 * 不在引擎侧自报。
 */
import { useEffect, useRef, useState } from "react";

/** busy 期静默超限 → staleSince = 静默起点(常驻);返回帧戳 stamp 与 stale 态。
 *  staleMs 可注入加速(测试/演示);真机默认 300s。 */
export function useTurnWatchdog(
  busy: boolean,
  staleMs = 300_000,
): { stamp: () => void; staleSince: number | null } {
  const lastAtRef = useRef(0);
  const [staleSince, setStaleSince] = useState<number | null>(null);
  useEffect(() => {
    if (!busy) {
      lastAtRef.current = 0;
      setStaleSince(null);
      return;
    }
    lastAtRef.current = lastAtRef.current || Date.now();
    const id = window.setInterval(() => {
      setStaleSince((prev) => {
        if (prev != null) return prev;
        return Date.now() - lastAtRef.current > staleMs ? lastAtRef.current : null;
      });
    }, 5_000);
    return () => window.clearInterval(id);
  }, [busy, staleMs]);
  return {
    stamp: () => {
      lastAtRef.current = Date.now();
      setStaleSince(null);
    },
    staleSince,
  };
}
