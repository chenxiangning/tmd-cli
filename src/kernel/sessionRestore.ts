/**
 * 重启现场恢复 —— settings.sessionRestore 的领域 API + 启动恢复编排。
 *
 * tab 条 ids 是 tmd PTY id,跨重启必死(sessionTabs.ts);本层把「打开事实」
 * 持久化为三段身份 key(`${wsId}:${profileId}:${cliSessionId}`,resume 换壳
 * tmd id 变、三段不变),启动错峰后据此逐个恢复回位。恢复链 = 侧栏点击同一
 * 通道 host.openDiskSession(自带 prefetchDiskTail 磁盘先行回放),不碰冻结
 * 快照(terminalFreeze:重开磁盘会话存档天然不命中)。
 *
 * 写入时机:sessionTabs trackOpen(activeSessionChanged 收敛)调 recordSessionKey
 * —— unshift 去重置顶 + 帽(settings.sessionTabsMax)尾部截断;最新 key 已在
 * 首位的重复聚焦零写盘(persist 是串行链无时间防抖,幂等短路即防抖)。
 * 读:仅启动恢复一次;运行期 settings 不再消费 keys。
 *
 * 失败矩阵(定稿 docs/design/042-candidates/9-session-restore.html,行为见
 * resolveSessionRestoreStep):畸形 key / 工作区已删 / 用户已删(tombstone)/
 * 磁盘会话已被清扫 → evict(恢复永落空,移出 keys);引擎缺失 / 无法预判存在性 /
 * spawn 失败 → 保留 key 下次再试;在途重复由 open() 活表去重 + 在途闸自己聚焦。
 * 失败一律静默 skip(与保留律/hygiene 同气质),进度 pill 只报进度不弹错误。
 *
 * 恢复编排的 for…of 串行 await(doctor 豁免 async-await-in-loop)是设计红线:
 * 逐个错峰回位,防启动期并发 spawn 压垮引擎与 PTY 预算。
 */

import { createSubscribable } from "./subscribable";
import { getSettingsState, updateSettings } from "./settings";
import { host } from "./host";
import { getWorkspaces, workspacesReady, type Workspace } from "./workspace";
import { findWorkspaceOrigin } from "./workspaceOrigins";
import { isSessionDeleted } from "./sessionDeleted";
import { sessionOverlayKey } from "./overlayEvict";
import type { CliProfile } from "./cli";

/** 恢复 key:三段身份,与静音/置顶/归档同构(经 sessionOverlayKey)。 */
export const sessionRestoreKey = sessionOverlayKey;

/** 进度快照(pill 订阅):active = 恢复进行中;done/total 以启动时 keys 数为分母。 */
export interface SessionRestoreProgress {
  active: boolean;
  done: number;
  total: number;
}

const progress = createSubscribable<SessionRestoreProgress>({ active: false, done: 0, total: 0 });

/** React 订阅恢复进度(AppShell 的 SessionRestorePill)。 */
export function useSessionRestoreProgress(): SessionRestoreProgress {
  return progress.useStore();
}

/** 非 React 读取恢复进度(测试断言/命令面)。 */
export function getSessionRestoreProgress(): SessionRestoreProgress {
  return progress.snapshot;
}

const runState = { started: false, aborted: false };

/** 用户「跳过本次恢复」:中止剩余 key(未跑的保留,下次启动再试)。 */
export function skipSessionRestore(): void {
  runState.aborted = true;
}

/** 记录三段 key:unshift 去重置顶 + 帽截断;最新已在首位时零写盘。 */
export function recordSessionKey(key: string): void {
  const { sessionRestore, sessionTabsMax } = getSettingsState().settings;
  if (sessionRestore.keys[0] === key) return;
  const keys = [key, ...sessionRestore.keys.filter((k) => k !== key)].slice(0, sessionTabsMax);
  updateSettings({ sessionRestore: { enabled: sessionRestore.enabled, keys } });
}

/** MRU keys 只读面(启动恢复与测试用)。 */
export function getSessionRestoreKeys(): readonly string[] {
  return getSettingsState().settings.sessionRestore.keys;
}

/** 总闸设置面(设置页开关)。 */
export function setSessionRestoreEnabled(enabled: boolean): void {
  updateSettings({
    sessionRestore: { ...getSettingsState().settings.sessionRestore, enabled },
  });
}

/** 三段 key 反解析:前两段定界,余段全归 cliSessionId(容忍其内冒号);缺段 = 畸形。 */
export function parseSessionRestoreKey(key: string): SessionRestoreIdentity | null {
  const a = key.indexOf(":");
  const b = a === -1 ? -1 : key.indexOf(":", a + 1);
  if (b === -1) return null;
  const wsId = key.slice(0, a);
  const profileId = key.slice(a + 1, b);
  const cliSessionId = key.slice(b + 1);
  if (!wsId || !profileId || !cliSessionId) return null;
  return { wsId, profileId, cliSessionId };
}

export interface SessionRestoreIdentity {
  wsId: string;
  profileId: string;
  cliSessionId: string;
}

/** 逐 key 决策依赖(纯函数注入面;编排侧传真实快照,测试传桩)。 */
export interface SessionRestoreDeps {
  /** wsId → 工作区(来自 getWorkspaces 快照)。 */
  workspaces: ReadonlyMap<string, Workspace>;
  hasProfile(profileId: string): boolean;
  isDeleted(key: string): boolean;
  /** (profile, root) 磁盘会话 id 全集;undefined = profile 无列举面,
   *  null = 列举失败 —— 两者均无法预判存在性。 */
  diskIds: ReadonlySet<string> | null | undefined;
}

export type SessionRestoreStep =
  | ({ key: string; action: "resume"; root: string } & SessionRestoreIdentity)
  | { key: string; action: "evict"; reason: "malformed" | "workspace" | "deleted" | "missing" }
  | { key: string; action: "keep"; reason: "profile" | "missing" };

/**
 * 失败矩阵(纯):解析 → 工作区在表?→ 引擎在?→ 用户已删?→ 磁盘在?
 * 判定序 = 便宜检查在前、磁盘列举最后(串行恢复每区只扫一次盘)。
 */
export function resolveSessionRestoreStep(key: string, deps: SessionRestoreDeps): SessionRestoreStep {
  const parsed = parseSessionRestoreKey(key);
  if (!parsed) return { key, action: "evict", reason: "malformed" };
  const ws = deps.workspaces.get(parsed.wsId);
  if (!ws) return { key, action: "evict", reason: "workspace" };
  if (!deps.hasProfile(parsed.profileId)) return { key, action: "keep", reason: "profile" };
  if (deps.isDeleted(key)) return { key, action: "evict", reason: "deleted" };
  if (deps.diskIds !== undefined) {
    if (deps.diskIds === null) return { key, action: "keep", reason: "missing" };
    if (!deps.diskIds.has(parsed.cliSessionId)) return { key, action: "evict", reason: "missing" };
  }
  return { key, action: "resume", root: ws.root, ...parsed };
}

/** 恢复延迟:与 hygieneBootSweep.BOOT_SWEEP_DELAY_MS 同值 —— 启动错峰统一
 *  让路首屏(保留律清扫同在 45s,先后不定,存在性预判兜住竞态;改须同改)。 */
const BOOT_RESTORE_DELAY_MS = 45_000;

/** ready 后 45s 一次性错峰恢复;返回取消函数。全程至多跑一次(重挂/双挂防重入)。 */
export function scheduleSessionRestore(): () => void {
  const timer = setTimeout(() => {
    if (runState.started) return;
    runState.started = true;
    void runSessionRestore();
  }, BOOT_RESTORE_DELAY_MS);
  return () => clearTimeout(timer);
}

/** 编排:enabled 短路 → readopt + 工作区表就绪 → 逐 key 串行(重操作不并行)
 *  → 终了单次回写 evict。 */
async function runSessionRestore(): Promise<void> {
  const { sessionRestore } = getSettingsState().settings;
  const keys = sessionRestore.keys;
  if (!sessionRestore.enabled || keys.length === 0) return;
  runState.aborted = false;
  /* 前置:webview 重载接管先行(活表齐了 open() 才能去重聚焦);慢盘宁等不扫空表。 */
  await host.readoptSessions().catch(() => undefined);
  await workspacesReady.catch(() => undefined);
  const workspaces = new Map(getWorkspaces().map((w) => [w.id, w] as const));
  /* 磁盘列举按 (profileId, root) 记忆化:同区多 key 只扫一次盘;列举失败记 null。 */
  const diskCache = new Map<string, Promise<ReadonlySet<string> | null>>();
  const diskIdsOf = (profileId: string, root: string): Promise<ReadonlySet<string> | null> => {
    const k = `${profileId}:${root}`;
    let p = diskCache.get(k);
    if (!p) {
      const listSessions = host.getCliProfile(profileId)?.listSessions;
      p = listSessions
        ? listSessions(root).then((l) => new Set(l.map((s) => s.id)), () => null)
        : Promise.resolve(null);
      diskCache.set(k, p);
    }
    return p;
  };
  progress.commit({ active: true, done: 0, total: keys.length });
  let done = 0;
  const evict = new Set<string>();
  try {
    for (const key of [...keys]) {
      if (runState.aborted) break; /* 剩余 key 保留,下次启动再试 */
      const parsed = parseSessionRestoreKey(key);
      const profile = parsed ? host.getCliProfile(parsed.profileId) : undefined;
      const ws = parsed ? workspaces.get(parsed.wsId) : undefined;
      /* 远程工作区(WSL/SSH):本机 listSessions 看不见远端会话,扫盘预判必误
         evict —— 跳过预判(diskIds undefined = 存在性不可知 = 保留,与失败矩阵
         「spawn 败保留」自洽),resume 落 openRemoteDiskSession 来源接管分支。 */
      const remote = ws != null && findWorkspaceOrigin(ws)?.remoteExec?.(ws) != null;
      const step = resolveSessionRestoreStep(key, {
        workspaces,
        hasProfile: (id) => host.getCliProfile(id) !== undefined,
        isDeleted: isSessionDeleted,
        /* 存在性预判:本地工作区且有列举面才扫盘(否则 undefined = 不预判) */
        diskIds:
          !remote && parsed && ws && profile?.listSessions
            ? await diskIdsOf(parsed.profileId, ws.root)
            : undefined,
      });
      if (step.action === "resume") {
        if (ws && profile) await resumeStep(step, ws, profile);
      } else if (step.action === "evict") {
        evict.add(key);
      }
      done += 1;
      progress.commit({ active: true, done, total: keys.length });
    }
  } finally {
    if (evict.size > 0) {
      const st = getSettingsState().settings.sessionRestore;
      updateSettings({ sessionRestore: { enabled: st.enabled, keys: st.keys.filter((k) => !evict.has(k)) } });
    }
    progress.commit({ active: false, done, total: keys.length });
  }
}

/** 单 key 回位:远程来源(WSL/SSH)先走来源接管(与侧栏行点击同款分流),
 *  否则 openDiskSession;失败静默(保留 key),绝不弹错。 */
async function resumeStep(
  step: Extract<SessionRestoreStep, { action: "resume" }>,
  ws: Workspace,
  profile: CliProfile,
): Promise<void> {
  try {
    if (findWorkspaceOrigin(ws)?.openRemoteDiskSession?.(ws, profile, step.cliSessionId)) return;
    await host.openDiskSession(step.profileId, step.root, step.wsId, step.cliSessionId);
  } catch {
    /* spawn 失败:静默保留 */
  }
}

/** 测试专用:复位编排态(vitest 复用同一模块实例)。 */
export function resetSessionRestoreForTest(): void {
  runState.started = false;
  runState.aborted = false;
  progress.replace({ active: false, done: 0, total: 0 });
}
