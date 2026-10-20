/**
 * 活会话转录浮层 working 计时 hook —— 2026-10-20 从 liveOverlay.tsx 拆出
 * (守 300 行铁则,零语义改动):活跃期每秒跳,静默归零。sinceRef 由主组件
 * 持有(轮询 effect 同拍写),本 hook 只读。
 */
import { useEffect, useState } from "react";
import type { MutableRefObject } from "react";

export function useLiveElapsed(
  turnActive: boolean,
  sinceRef: MutableRefObject<number | null>,
): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!turnActive) {
      setElapsed(0);
      return;
    }
    const timer = setInterval(() => {
      setElapsed(sinceRef.current ? Math.max(1, Math.round((Date.now() - sinceRef.current) / 1000)) : 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [turnActive, sinceRef]);
  return elapsed;
}
