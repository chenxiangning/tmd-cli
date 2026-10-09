/**
 * useMinSpin —— 刷新类按钮的点击反馈保底:动作无论多快落定,忙态至少持续
 * minMs(默认 600ms ≈ tmdSpin 大半圈),保证「点一下必转一圈」可见反馈。
 * 纯反馈不拦截点击:忙态期内再点会顺延忙态窗(旧 timer 被批次号拦下),事件本身不吞;
 * 需防重复提交(如删除类按钮)由调用方自行 disabled,本原语不提供。
 * 计时核抽至 createMinSpinCore(纯 timer 状态机,node 环境可直测,见 useMinSpin.test.ts),
 * hook 只留 React 壳。
 */
import { useCallback, useEffect, useMemo, useState } from "react";

export interface MinSpin {
  /** 当前是否处于保底忙态(点击后至少 minMs)。 */
  spinning: boolean;
  /** 执行 run 并保底转 minMs:run 落定(含同步抛错归一)后剩余窗内保持忙态。 */
  spin: (run: () => unknown) => void;
}

/** 计时核契约(hook 与测试共同消费)。 */
export interface MinSpinCore {
  spin: (run: () => unknown) => void;
  dispose: () => void;
}

/** 计时核:批次号 + 单 timer 状态机。测试经它直测,不依赖 React 挂载。 */
export function createMinSpinCore(setSpinning: (v: boolean) => void, minMs = 600): MinSpinCore {
  let batch = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const spin = (run: () => unknown) => {
    const my = ++batch;
    const t0 = Date.now();
    setSpinning(true);
    /* onRefresh 实现可能同步抛错:.then 包一层归入 rejection,finish 必然清忙态 */
    const finish = () => {
      /* 迟到落定守卫:新点击已接管计时后,旧 spin 的 finish 不得 clearTimeout
       * (会杀掉新点击的停表 timer,而自身批次号守卫又 no-op → 忙态永久卡死)。 */
      if (batch !== my) return;
      const wait = Math.max(0, minMs - (Date.now() - t0));
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (batch === my) setSpinning(false);
      }, wait);
    };
    void Promise.resolve()
      .then(run)
      .then(finish, finish);
  };
  return {
    spin,
    dispose: () => clearTimeout(timer),
  };
}

export function useMinSpin(minMs = 600): MinSpin {
  const [spinning, setSpinning] = useState(false);
  const core = useMemo(() => createMinSpinCore(setSpinning, minMs), [minMs]);
  useEffect(() => core.dispose, [core]);
  const spin = useCallback((run: () => unknown) => core.spin(run), [core]);
  return { spinning, spin };
}
