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
import { getActiveTabId, getTab, getTabs, openTab, setActiveTab } from "./tabs";
import { subscribeEditorTabs } from "./tabs";
import { noteClosedSsSession, hasClosedSsSession } from "./structuredSessionEnded";

export const STRUCTURED_SESSION_TAB_KIND = "structured-session";
/* cwd 段转义:# 是 resume 后缀分隔符,cwd 含 #/% 须编码(id 可逆,解码见 structuredSessionTarget)。 */
const encCwd = (cwd: string) => cwd.replaceAll("%", "%25").replaceAll("#", "%23");
const decCwd = (cwd: string) => cwd.replaceAll("%23", "#").replaceAll("%25", "%");

/** tab 负载:引擎 profile id + 落地 cwd(开 tab 快照);adoptStreamId 仅 boot 收养路径携带。 */
export interface StructuredSessionPayload {
  profileId: string;
  cwd: string;
  adoptStreamId?: string;
  /** resume 目标(tmd.ss.last/磁盘行);resumeUnsettled = busy 中关闭(末轮未结算,种子剪尾防重放)。 */
  resumeSessionId?: string;
  resumeUnsettled?: boolean;
}

/** 账本副键 → structured tab 目标;普通 PTY 身份返回 null。resume 判别后缀
 *  (# 段)剥除 + cwd 段解转义 —— 存证/收养只关心引擎 + cwd 二维。 */
export function structuredSessionTarget(ledgerId: string | undefined): StructuredSessionPayload | null {
  if (!ledgerId?.startsWith("structured:")) return null;
  const rest = ledgerId.slice("structured:".length);
  const sep = rest.indexOf(":");
  if (sep <= 0 || sep === rest.length - 1) return null;
  const tail = rest.slice(sep + 1);
  const hash = tail.lastIndexOf("#");
  return { profileId: rest.slice(0, sep), cwd: decCwd(hash > 0 ? tail.slice(0, hash) : tail) };
}

/** 开一个结构化会话 tab。tab id = 引擎 + cwd 二维;resume 重开再叠会话判别
 * 后缀(`#{cliSessionId}`)—— 同工作区同引擎可并行多个 RPC 会话(PTY parity):
 * 点磁盘行 resume 不再被在跑的同名 tab 吞掉(激活既有 ≠ 换会话)。同 id 已开
 * = 激活既有(openTab 语义)。cwd 缺省当前工作区根。
 * adopt:boot 收养既有 proc 流 —— tab 内容挂载时订阅该流而非新 spawn
 * (webview reload 重接链,会话体系对齐批次 3)。 */
export function openStructuredSessionTab(
  profileId: string,
  cwd?: string,
  opts?: { adoptStreamId?: string; resumeSessionId?: string; resumeUnsettled?: boolean },
): void {
  const root = cwd ?? getActiveWorkspace()?.root ?? getWorkspaces()[0]?.root;
  if (!root) return;
  const base = `structured:${profileId}:${encCwd(root)}`;
  const id = opts?.resumeSessionId ? `${base}#${opts.resumeSessionId}` : base;
  openTab({
    id,
    kind: STRUCTURED_SESSION_TAB_KIND,
    title: `${host.getCliProfile(profileId)?.name ?? profileId} · ${t("带渲染的会话")}`,
    path: root,
    payload: {
      profileId,
      cwd: root,
      ...(opts?.adoptStreamId ? { adoptStreamId: opts.adoptStreamId } : {}),
      ...(opts?.resumeSessionId ? { resumeSessionId: opts.resumeSessionId } : {}),
      ...(opts?.resumeSessionId && opts.resumeUnsettled ? { resumeUnsettled: true } : {}),
    } satisfies StructuredSessionPayload,
  });
}

/** 历史深链:目标会话的活 tab(含 # 会话判别后缀的精确匹配)直接激活;
 *  已关闭则读原 CLI 磁盘转录,绝不新起空 RPC 假报跳转。 */
export function openStructuredSessionTranscript(
  target: StructuredSessionPayload,
  cliSessionId: string,
  text: string,
  occurrence = 1,
): JumpTextOutcome {
  const base = `structured:${target.profileId}:${encCwd(target.cwd)}`;
  const exact = `${base}#${cliSessionId}`;
  const live = getTabs().find((tab) => tab.id === exact) ?? getTabs().find((tab) => tab.id === base);
  if (live) {
    openStructuredSessionTab(target.profileId, target.cwd,
      live.id === exact ? { resumeSessionId: cliSessionId } : undefined);
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
  /** 本会话用户消息文本流(时间线面板消费;引擎 session id 变前后持续追加)。 */
  userTexts: string[];
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
  phase: "starting", busy: false, busySince: null, waitingConfirm: false, sessionId: null, unread: 0, userTexts: [],
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
  /* 关闭捕获(结束账本):tab 消失瞬间留行快照,「带渲染的会话」分区存续
   * 可 resume(未握手 sessionId 空的壳不入账);须在孤儿态清理前读旧快照。 */
  for (const r of rowsStore.snapshot) {
    if (!getTab(r.tabId) && r.sessionId) {
      noteClosedSsSession({ profileId: r.profileId, cwd: r.cwd, sessionId: r.sessionId, title: r.title, busy: r.busy });
    }
  }
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

/** React 订阅(workspace 左栏分区消费)。 */
export function useStructuredSessionRows(): readonly StructuredSessionRow[] {
  return rowsStore.useStore();
}

/** 会话 id 是否被 RPC 侧在册(活行绑定/resume 目标 ∪ 结束账本)。工作区
 *  磁盘历史行据此让位:该会话由「带渲染的会话」分区呈现,不与 PTY 磁盘行
 *  混排(R-ISO1 列表层分割);分区移除后自动回落磁盘历史。 */
export function isSsSessionTracked(sessionId: string): boolean {
  return hasClosedSsSession(sessionId) || rowsStore.snapshot.some((r) => {
    if (r.sessionId === sessionId) return true;
    const payload = getTab(r.tabId)?.payload as StructuredSessionPayload | undefined;
    return payload?.resumeSessionId === sessionId;
  });
}

/* ── 上次会话记忆(批次 4)──磁盘行「继续对话」数据面(菜单「重开上次」入口
 * 2026-11-05 撤除):key = 引擎+cwd,value = 引擎会话 id;单键滚动,无过期。 */

const lastKey = (profileId: string, cwd: string) => `tmd.ss.last.${profileId}:${cwd}`;

export function readLastSsSession(profileId: string, cwd: string): string | null {
  try {
    return localStorage.getItem(lastKey(profileId, cwd));
  } catch {
    return null;
  }
}

export function noteLastSsSession(profileId: string, cwd: string, sessionId: string): void {
  try {
    localStorage.setItem(lastKey(profileId, cwd), sessionId);
  } catch {
    /* 隐私模式/配额:记忆缺失只损失磁盘行「继续对话」判别,不影响会话本体 */
  }
}

/* ── RPC 会话身份记忆:已知 RPC 会话 id 全局集合(封顶 200 滚动);磁盘历史行
 * 据此出「带渲染」徽标 + 「继续对话」入口(R-ISO1:RPC/PTY 入口在工作区内可辨)。 */

const RPC_IDS_KEY = "tmd.ss.rpcids";
const RPC_IDS_CAP = 200;

/** 登记一个 RPC 会话 id(ready 时调用;重复 = 前移,无副效;损坏值按
 *  空表自愈重写)。 */
export function noteSsRpcSession(sessionId: string): void {
  let ids: string[] = [];
  try {
    const raw = JSON.parse(localStorage.getItem(RPC_IDS_KEY) ?? "[]") as unknown;
    if (Array.isArray(raw)) ids = raw as string[];
  } catch {
    /* 损坏值按空表自愈(下一句重写落盘) */
  }
  try {
    const next = [sessionId, ...ids.filter((id) => id !== sessionId)].slice(0, RPC_IDS_CAP);
    localStorage.setItem(RPC_IDS_KEY, JSON.stringify(next));
  } catch {
    /* 存储失效:行徽标降级为无标记,不影响会话本体 */
  }
}

/** 磁盘行是否为已知 RPC 会话(RPC/PTY 入口区分的判据)。 */
export function isSsRpcSession(sessionId: string): boolean {
  try {
    return (JSON.parse(localStorage.getItem(RPC_IDS_KEY) ?? "[]") as string[]).includes(sessionId);
  } catch {
    return false;
  }
}

/* ── 行覆盖层(批次 5):重命名/静音,自有 localStorage 键(RPC 行不接
 * sessionTitles/sessionMutes —— 那两服务按 PTY sessionId 键,零共享)。 */

const overlayKey = (profileId: string, cwd: string, kind: "title" | "mute") =>
  `tmd.ss.${kind}.${profileId}:${cwd}`;

export function readSsTitleOverride(profileId: string, cwd: string): string | null {
  try {
    return localStorage.getItem(overlayKey(profileId, cwd, "title"));
  } catch {
    return null;
  }
}

export function noteSsTitleOverride(profileId: string, cwd: string, title: string | null): void {
  try {
    if (title) localStorage.setItem(overlayKey(profileId, cwd, "title"), title);
    else localStorage.removeItem(overlayKey(profileId, cwd, "title"));
  } catch {
    /* 覆盖层缺失回落自动标题 */
  }
}

export function isSsMuted(profileId: string, cwd: string): boolean {
  try {
    return localStorage.getItem(overlayKey(profileId, cwd, "mute")) === "1";
  } catch {
    return false;
  }
}

export function toggleSsMute(profileId: string, cwd: string): boolean {
  const next = !isSsMuted(profileId, cwd);
  try {
    if (next) localStorage.setItem(overlayKey(profileId, cwd, "mute"), "1");
    else localStorage.removeItem(overlayKey(profileId, cwd, "mute"));
  } catch {
    /* 静音态丢失只影响通知面 */
  }
  return next;
}

/** 通知深链等「回我本来那个会话」场景:按原 tab id 精确激活;tab 已关则
 *  回落开一个同引擎同 cwd 的新会话(多会话并行后不误激活别的 RPC 会话)。 */
export function focusStructuredSessionTab(tabId: string, profileId: string, cwd: string): void {
  if (getTabs().some((tab) => tab.id === tabId)) setActiveTab(tabId);
  else openStructuredSessionTab(profileId, cwd);
}
