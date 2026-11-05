/**
 * 结构化会话 tab 契约 + 左栏行投影(kernel)—— 先例 sessionViewTabs:多插件
 * 需要同一深链/契约时收敛 kernel,插件间零直接依赖。双消费方:structured-session
 * (tab 开启与运行态广播)+ workspace(左栏「带渲染的会话」分区渲染)。
 *
 * 行投影纪律(R-PTY0,RPC 会话体系对齐规划 docs/brainstorm/2026-11-05):
 * 身份源 = 中央 tab 注册表(kind 过滤,tab 关闭即剔行,无孤儿行);运行态 =
 * structured-session 经 noteStructuredSessionRow 广播(patch 覆盖)。不读 PTY
 * 会话注册表、不进 workspace sessions 派生链(防折叠/归档/hygiene 误吞行)。
 */

import { host } from "./host";
import { getActiveWorkspace, getWorkspaces } from "./workspace";
import { isSessionViewAvailable, openSessionViewAtText } from "./sessionViewTabs";
import type { JumpTextOutcome } from "./anchorJump";
import { createSubscribable } from "./subscribable";
import { t } from "./i18n";
import { getActiveTabId, getTab, getTabs, openTab } from "./tabs";
import { subscribeEditorTabs } from "./tabs";

export const STRUCTURED_SESSION_TAB_KIND = "structured-session";

/** tab 负载:引擎 profile id + 落地 cwd(开 tab 时快照,随会话走)。 */
export interface StructuredSessionPayload {
  profileId: string;
  cwd: string;
}

/** checkpoint/footprint 账本副键 → structured tab 目标;普通 PTY 身份返回 null。 */
export function structuredSessionTarget(ledgerId: string | undefined): StructuredSessionPayload | null {
  if (!ledgerId?.startsWith("structured:")) return null;
  const rest = ledgerId.slice("structured:".length);
  const sep = rest.indexOf(":");
  if (sep <= 0 || sep === rest.length - 1) return null;
  return { profileId: rest.slice(0, sep), cwd: rest.slice(sep + 1) };
}

/** 开一个结构化会话 tab(同引擎同 cwd 已开 = 激活既有);cwd 缺省当前工作区根。 */
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

/* ── 左栏行投影 ────────────────────────────────────────────────
 * 行生命周期:tab open 即出行(默认态),tab 关闭即剔行(editorTabs 订阅自动
 * 同步);运行态由 structured-session 的 sessionTab effect 广播,细粒度 patch
 * 覆盖缺省值。快照不可变(引用稳定,见 subscribable 契约)。 */

/** 行运行态(tab 挂载后由 structured-session 广播;缺省 = starting 静止)。 */
export interface StructuredSessionRowStatus {
  phase: "starting" | "ready" | "exited" | "error";
  busy: boolean;
  /** busy 起始时刻(ms;行上自算 working 计时,不逐秒广播)。 */
  busySince: number | null;
  waitingConfirm: boolean;
  sessionId: string | null;
  /** 轮结算未读计数(因果 = busy true→false 沿;tab 激活即清,见下方订阅)。 */
  unread: number;
}

/** 左栏行(身份来自 tab 本体,运行态来自广播;workspace 分区渲染消费)。 */
export interface StructuredSessionRow extends StructuredSessionRowStatus {
  tabId: string;
  profileId: string;
  cwd: string;
  title: string;
}

const statusById = new Map<string, StructuredSessionRowStatus>();

const DEFAULT_STATUS: StructuredSessionRowStatus = {
  phase: "starting", busy: false, busySince: null, waitingConfirm: false, sessionId: null, unread: 0,
};

function snapshotRows(): readonly StructuredSessionRow[] {
  return getTabs()
    .filter((tab) => tab.kind === STRUCTURED_SESSION_TAB_KIND)
    .map((tab) => {
      const payload = tab.payload as StructuredSessionPayload;
      return {
        tabId: tab.id,
        profileId: payload.profileId,
        cwd: payload.cwd,
        title: tab.title,
        ...DEFAULT_STATUS,
        ...statusById.get(tab.id),
      };
    });
}

const rowsStore = createSubscribable<readonly StructuredSessionRow[]>(snapshotRows());

/** tab 集变化(open/close/title 刷新/激活切换)→ 重算行集;激活 structured tab
 *  即读(unread 清零 —— 点行与点中央 tab 条同走 setActiveTab,单一出口)。 */
subscribeEditorTabs(() => {
  for (const id of statusById.keys()) {
    if (!getTab(id)) statusById.delete(id); /* 顺手清孤儿态,防跨会话泄漏 */
  }
  const activeId = getActiveTabId();
  const activeStatus = activeId ? statusById.get(activeId) : undefined;
  if (activeId != null && activeStatus?.unread) statusById.set(activeId, { ...activeStatus, unread: 0 });
  rowsStore.commit(snapshotRows());
});

/** structured-session 广播行运行态(patch 合并;tab 不存在时忽略,不复活已关 tab)。 */
export function noteStructuredSessionRow(tabId: string, patch: Partial<StructuredSessionRowStatus>): void {
  if (!getTab(tabId)) return;
  statusById.set(tabId, { ...DEFAULT_STATUS, ...statusById.get(tabId), ...patch });
  rowsStore.commit(snapshotRows());
}

/** 行集快照(非响应式;测试与命令式消费方用,同 getTabs 惯例)。 */
export function getStructuredSessionRows(): readonly StructuredSessionRow[] {
  return rowsStore.snapshot;
}

/** 行集快照(React 订阅;workspace 左栏分区消费)。 */
export function useStructuredSessionRows(): readonly StructuredSessionRow[] {
  return rowsStore.useStore();
}
