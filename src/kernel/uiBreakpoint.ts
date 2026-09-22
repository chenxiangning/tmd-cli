/**
 * UI 断点原语 —— 跨插件共享的视口判定(通用宿主机制,非单插件语义)。
 * 插件要消费窄屏态但不得 import app-shell(R4),自 shellHooks 下沉至此。
 */
import { useEffect, useState } from "react";

/** 窄屏(手机)断点判定:matchMedia 订阅,默认 768px。 */
export function useIsNarrow(maxPx = 768): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.innerWidth <= maxPx,
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${maxPx}px)`);
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [maxPx]);
  return narrow;
}
