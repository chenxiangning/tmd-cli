/** 工作台本页页签/文档过滤状态 + 深链跟移(批次 C 自 WorkbenchTab 抽出,
 * 守 react-doctor 复杂度铁则):openWorkbenchDocsTab / openWorkbenchReviewTab
 * 重开本 tab 换 payload,页签与过滤在渲染期跟移(wbDeepLink 归一)。 */
import { useState } from "react";
import type { WbTab } from "./wbTabs";
import { deepLinkTarget, type WbConsolePayload } from "./wbDeepLink";

export function useWbDeepLink(payload: WbConsolePayload | null) {
  const [tab, setTab] = useState<WbTab>(payload?.tab === "docs" ? "docs" : "overview");
  const [docsFilter, setDocsFilter] = useState<string | null>(payload?.projectFilter ?? null);
  const [lastPayload, setLastPayload] = useState(payload);
  if (lastPayload !== payload) {
    setLastPayload(payload);
    const target = deepLinkTarget(payload);
    if (target) {
      setTab(target.tab);
      if (target.tab === "docs") setDocsFilter(target.docsFilter ?? null);
    }
  }
  return { tab, setTab, docsFilter, setDocsFilter };
}
