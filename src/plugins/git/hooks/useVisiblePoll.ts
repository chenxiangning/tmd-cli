/**
 * 可见性门控轮询脚手架 —— git 面板三 hook(useGitRepos/useGitStatus/useGitTotals)
 * 共用:挂载即拉一次 + interval 周期拉取(仅页面可见时)+ 失焦转可见即拉。
 * 取数纪律(proposal §2.7):重操作不挂高频轮询,节奏由调用方传 ms。
 */
import { useEffect } from "react";

export function useVisiblePoll(refresh: () => Promise<void>, ms: number): void {
  useEffect(() => {
    refresh();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, ms);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh, ms]);
}
