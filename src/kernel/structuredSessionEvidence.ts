/**
 * 活跃 RPC 存证视角(处理插件对接:审批线/时间线面板消费)—— 身份/行投影
 * 的读侧封装,独立成文为 structuredSessionTabs 减压(300 行铁则)。
 * 活跃 PTY 会话(host.getActiveSessionId)缺席、而活跃编辑 tab 是带渲染的
 * 会话时,存证面板切到 RPC 视角:账本副键 = tab id(= StructuredTurnEvidence
 * 的 ledgerId,后端 entry_in_session 按 tmd_session_id 命中),cwd 取 tab
 * 负载;引擎 sid 仅作查询主键候选(resume 换壳后由副键兜住)。
 */

import { getActiveTabId, getTab } from "./tabs";
import {
  getStructuredSessionRows,
  STRUCTURED_SESSION_TAB_KIND,
  type StructuredSessionPayload,
} from "./structuredSessionTabs";

export interface ActiveRpcEvidenceView {
  tabId: string;
  profileId: string;
  cwd: string;
  /** 引擎会话 id(行投影广播;未握手时为 null,查询主键回落 tabId)。 */
  engineSessionId: string | null;
  /** 本会话用户消息文本流(时间线面板直读,不经 PTY 锚点轮询)。 */
  userTexts: string[];
}

/** 活跃编辑 tab 为 structured 时出 RPC 存证视角,否则 null。 */
export function getActiveRpcEvidenceView(): ActiveRpcEvidenceView | null {
  const activeId = getActiveTabId();
  if (!activeId) return null;
  const tab = getTab(activeId);
  if (!tab || tab.kind !== STRUCTURED_SESSION_TAB_KIND) return null;
  const payload = tab.payload as StructuredSessionPayload;
  const row = getStructuredSessionRows().find((r) => r.tabId === activeId);
  return {
    tabId: activeId,
    profileId: payload.profileId,
    cwd: payload.cwd,
    engineSessionId: row?.sessionId ?? null,
    userTexts: row?.userTexts ?? [],
  };
}
