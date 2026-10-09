/**
 * useMinSpin —— 刷新类按钮的点击反馈保底:动作无论多快落定,忙态至少持续
 * minMs(默认 600ms ≈ tmdSpin 大半圈),保证「点一下必转一圈」可见反馈。
 * 并发防抖口径同原 FileTreeToolbar 批次号:忙态期间重复点击不重启计时。
 */
import { useCallback, useEffect, useRef, useState } from "react";

export interface MinSpin {
  /** 当前是否处于保底忙态(点击后至少 minMs)。 */
  spinning: boolean;
  /** 执行 run 并保底转 minMs:run 落定(含同步抛错归一)后剩余窗内保持忙态。 */
  spin: (run: () => unknown) => void;
}

export function useMinSpin(minMs = 600): MinSpin {
  const [spinning, setSpinning] = useState(false);
  const batchRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => {
    clearTimeout(timerRef.current);
  }, []);
  const spin = useCallback(
    (run: () => unknown) => {
      const my = ++batchRef.current;
      const t0 = Date.now();
      setSpinning(true);
      /* onRefresh 实现可能同步抛错:.then 包一层归入 rejection,finish 必然清忙态 */
      const finish = () => {
        const wait = Math.max(0, minMs - (Date.now() - t0));
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          if (batchRef.current === my) setSpinning(false);
        }, wait);
      };
      void Promise.resolve()
        .then(run)
        .then(finish, finish);
    },
    [minMs],
  );
  return { spinning, spin };
}
