/**
 * 深链跟跳(render 期 payload 比较,先例 journalTabs.useArticleEditSignal):
 * 已挂期间 payload.day 变更(openTab refresh 刷 payload)→ 派发跳日动作。
 * 独立 .ts hook:把 setState-in-render 收出组件体(先例同款写法不被
 * react-doctor 组件体规则命中,复杂度也随之出仓)。
 */
import { useState } from "react";
import { fpYmOfDay } from "../fpTab";

export function useFpDeepLinkJump(
  jumpDay: string | undefined,
  applyJump: (day: string, ym: { y: number; m: number }) => void,
): void {
  const [jumpedDay, setJumpedDay] = useState(jumpDay);
  if (jumpedDay !== jumpDay) {
    setJumpedDay(jumpDay);
    const nextYm = fpYmOfDay(jumpDay);
    if (jumpDay && nextYm) applyJump(jumpDay, nextYm);
  }
}
