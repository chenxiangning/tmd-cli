/**
 * structured-session tab 开启助手与负载契约(先例 kernel sessionViewTabs):
 * 同引擎同 cwd 已开 = 激活既有 tab;cwd 缺省当前工作区根。
 */
import { openTab } from "@kernel/tabs";
import { host } from "@kernel/host";
import { getWorkspaces } from "@kernel/workspace";
import { t } from "@kernel/i18n";

export const STRUCTURED_SESSION_TAB_KIND = "structured-session";

/** tab 负载:引擎 profile id + 落地 cwd(开 tab 时快照,随会话走)。 */
export interface StructuredSessionPayload {
  profileId: string;
  cwd: string;
}

/** 开一个结构化会话 tab(同引擎已开 = 激活既有);cwd 缺省当前工作区根。 */
export function openStructuredSessionTab(profileId: string, cwd?: string): void {
  const root = cwd ?? getWorkspaces()[0]?.root;
  if (!root) return;
  openTab({
    id: `structured:${profileId}:${root}`,
    kind: STRUCTURED_SESSION_TAB_KIND,
    title: `${host.getCliProfile(profileId)?.name ?? profileId} · ${t("结构化")}`,
    path: root,
    payload: { profileId, cwd: root } satisfies StructuredSessionPayload,
  });
}
