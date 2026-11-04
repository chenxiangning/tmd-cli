/**
 * structured-session tab 开启助手与负载契约(先例 kernel sessionViewTabs):
 * 同引擎同 cwd 已开 = 激活既有 tab;cwd 缺省当前工作区根。
 */
import { getTabs, openTab } from "@kernel/tabs";
import { host } from "@kernel/host";
import { getActiveWorkspace, getWorkspaces } from "@kernel/workspace";
import { isSessionViewAvailable, openSessionViewAtText } from "@kernel/sessionViewTabs";
import type { JumpTextOutcome } from "@kernel/anchorJump";
import { t } from "@kernel/i18n";

export const STRUCTURED_SESSION_TAB_KIND = "structured-session";

/** tab 负载:引擎 profile id + 落地 cwd(开 tab 时快照,随会话走)。 */
export interface StructuredSessionPayload {
  profileId: string;
  cwd: string;
}

/** checkpoint/footprint 账本副键 → structured tab 目标；普通 PTY 身份返回 null。 */
export function structuredSessionTarget(ledgerId: string | undefined): StructuredSessionPayload | null {
  if (!ledgerId?.startsWith("structured:")) return null;
  const rest = ledgerId.slice("structured:".length);
  const sep = rest.indexOf(":");
  if (sep <= 0 || sep === rest.length - 1) return null;
  return { profileId: rest.slice(0, sep), cwd: rest.slice(sep + 1) };
}

/** 开一个结构化会话 tab(同引擎已开 = 激活既有);cwd 缺省当前工作区根。 */
export function openStructuredSessionTab(profileId: string, cwd?: string): void {
  const root = cwd ?? getActiveWorkspace()?.root ?? getWorkspaces()[0]?.root;
  if (!root) return;
  openTab({
    id: `structured:${profileId}:${root}`,
    kind: STRUCTURED_SESSION_TAB_KIND,
    title: `${host.getCliProfile(profileId)?.name ?? profileId} · ${t("带渲染的会话")}`,
    path: root,
    payload: { profileId, cwd: root } satisfies StructuredSessionPayload,
  });
}

/** 历史深链:活 tab 直接激活;已关闭则读原 CLI 磁盘转录,绝不新起空 RPC 假报跳转。 */
export function openStructuredSessionTranscript(
  target: StructuredSessionPayload,
  cliSessionId: string,
  text: string,
  occurrence = 1,
): JumpTextOutcome {
  const tabId = `structured:${target.profileId}:${target.cwd}`;
  if (getTabs().some((tab) => tab.id === tabId)) {
    openStructuredSessionTab(target.profileId, target.cwd);
    return "jumped";
  }
  if (!isSessionViewAvailable()) return "miss";
  openSessionViewAtText({ ...target, cliSessionId }, text, occurrence);
  return "opened";
}
