/** 工作台本页深链归一(批次 C 自 WorkbenchTab 抽出,守 react-doctor 复杂度铁则):
 * openWorkbenchDocsTab / openWorkbenchReviewTab 重开本 tab 换 payload,
 * 页签与文档过滤跟移(渲染期调整);无深链返回 null,调用方零动作。 */
import type { WbTab } from "./wbTabs";
import type { ReviewTabPayload } from "./review/reviewTabs";

export interface WbConsolePayload {
  tab?: string;
  projectFilter?: string;
  review?: ReviewTabPayload;
}

/** docs:页签与过滤同移;journal:只落回顾页签(文档过滤保持原状)。 */
export function deepLinkTarget(
  payload: WbConsolePayload | null,
): { tab: WbTab; docsFilter?: string | null } | null {
  if (payload?.tab === "docs") {
    return { tab: "docs", docsFilter: payload.projectFilter ?? null };
  }
  if (payload?.tab === "journal") {
    /* 回顾深链(reviewTabs.openWorkbenchReviewTab):落到回顾页签 */
    return { tab: "journal" };
  }
  return null;
}
