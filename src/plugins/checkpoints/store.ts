/**
 * checkpoints store —— 右栏审批线面板与中央批审阅单共享的批次状态仓
 * (对齐 git 插件 panelStore 惯例:模块级 store + useSyncExternalStore)。
 *
 * 会话严格绑定:状态仓按 (cwd, sessionId) 键控,清单由后端从账本只读导出
 * (工作区 + 会话 + 轮次三元组落盘,封口即定死,不再现场推导)。
 * 数据流:promptSent → captureAnchor(记账锚点,隐式封上一轮) /
 * turnSettled → sealTurn(封口固化 turn 条目) → refreshBatches;
 * 强退恢复 → sealDeadTurns(面板首挂时代封上一运行的开放锚点);
 * 回退/反悔动作后各自 refresh。清单刷新失败保留旧批(error 态由面板渲染),
 * diff 按批懒加载缓存;清单不挂轮询(UI 挂载期间 6s 轻刷新,保证 open 批
 * 的 live 分类跟进)。
 */

import { useSyncExternalStore } from "react";
import { ipc, type CkptAnchorMeta, type CkptBatch, type CkptPatch } from "@kernel/ipc";

export interface CwdCkptState {
  batches: CkptBatch[];
  loading: boolean;
  error: string | null;
  /** E_NOT_A_REPO:MVP 仅支持 git 工作区 */
  notARepo: boolean;
}

const EMPTY: CwdCkptState = { batches: [], loading: false, error: null, notARepo: false };
/** key = `${cwd}|${sessionId}` */
const byKey = new Map<string, CwdCkptState>();
/** cwd → batchId → patches(懒加载缓存) */
const diffCache = new Map<string, Map<string, CkptPatch[]>>();

const listeners = new Set<() => void>();
let version = 0;
function emit() {
  version += 1;
  listeners.forEach((fn) => fn());
}

function stateKey(cwd: string, sessionId: string): string {
  return `${cwd}|${sessionId}`;
}

function setKey(key: string, patch: Partial<CwdCkptState>): void {
  byKey.set(key, { ...EMPTY, ...byKey.get(key), ...patch });
  emit();
}

function isNotARepoError(e: unknown): boolean {
  return String(e).startsWith("E_NOT_A_REPO:");
}

/**
 * 拉批次清单(幂等)。tmdSessionId:首条 prompt 打锚点时 CLI 磁盘身份常未绑上,
 * 锚点落在 tmd 会话 id 名下;后端按 (sessionId, tmdSessionId) 双字段命中并自动回填。
 * 失败语义:保留上一次的 batches(只置 error,不清空)—— 一次瞬时失败(git
 * 并发、IPC 抖动)不得把时间线打回「没有批次」的假象;首拉失败 = 空清单 +
 * error,由面板渲染错误态。
 */
export function refreshBatches(
  cwd: string,
  sessionId: string,
  tmdSessionId?: string,
): Promise<void> {
  if (!cwd || !sessionId) return Promise.resolve();
  const key = stateKey(cwd, sessionId);
  setKey(key, { loading: true });
  return ipc
    .checkpointList(cwd, sessionId, tmdSessionId)
    .then((batches) => {
      byKey.set(key, { batches, loading: false, error: null, notARepo: false });
      emit();
    })
    .catch((e: unknown) => {
      const msg = String(e);
      byKey.set(key, {
        batches: byKey.get(key)?.batches ?? [],
        loading: false,
        error: msg,
        notARepo: isNotARepoError(msg),
      });
      emit();
    });
}

/**
 * 记第 N 轮锚点(prompt 发送瞬间);后端隐式先封上一轮并做 CLI 身份回填。
 * meta = 发送时刻的引擎/模型/思考强度快照,随锚点固化进账本。
 * attribution = 归因模式:profile 声明 editMarks → "events"(AI 写入事件流,
 * 审批线跟随 AI 输出落账),否则 "git"(窗口推断,旧行为)。
 * 失败后台重试一次,不阻塞发送路径。
 */
export function captureAnchor(
  cwd: string,
  sessionId: string,
  tmdSessionId: string,
  prompt: string,
  meta: CkptAnchorMeta,
  attribution: "events" | "git" = "git",
): void {
  const run = () =>
    ipc.checkpointAnchor(cwd, sessionId, tmdSessionId, prompt, meta, attribution);
  run().catch(() => {
    window.setTimeout(() => {
      run()
        .then(() => refreshBatches(cwd, sessionId, tmdSessionId))
        .catch(() => {
          /* 两次都失败:本锚点缺失,本轮变更并入下一轮窗口(封口推导的自然兜底) */
        });
    }, 1500);
    return;
  });
  // 快路径:capture 完成有延迟,定时刷新也会兜住
  window.setTimeout(() => void refreshBatches(cwd, sessionId, tmdSessionId), 800);
}

/**
 * AI 写入事件流式记账(EditWatch / 会话磁盘事件拉取命中即调,events 模式会话)。
 * 前像三级解析是历史态(anchor 基线/上一轮批后像),不依赖调用时刻 —— 磁盘事件
 * 源(带 ts)哪怕迟到也记对轮次;ts 早于锚点 = 上一轮尾巴,Rust 侧守卫丢弃。
 * 失败重试一次(丢事件 = 丢前像,值得一次补救);再失败静默(封口兜底)。
 */
export function recordEdit(
  cwd: string,
  sessionId: string,
  tmdSessionId: string,
  path: string,
  ts?: number,
): void {
  const run = () => ipc.checkpointRecordEdit(cwd, sessionId, tmdSessionId, path, ts ?? null);
  run().catch(() => {
    window.setTimeout(() => run().catch(() => {}), 1000);
  });
}

/** 显式封口(一轮对话结算):把最新锚点以来的变更固化成账本 turn 条目。 */
export function sealTurn(cwd: string, sessionId: string, tmdSessionId: string): void {
  if (!cwd || !sessionId) return;
  ipc
    .checkpointSeal(cwd, sessionId, tmdSessionId)
    .then(() => refreshBatches(cwd, sessionId, tmdSessionId))
    .catch(() => {
      /* 封口失败不打断会话:下一条 prompt 的 anchor 会隐式补封 */
    });
}

// ---- 保留策略 --------------------------------------------------------------

/** 与面板「100/30 天」文案一致:每 cwd 保最近 100 批、超期 30 天清理。 */
export const CKPT_KEEP = 100;
export const CKPT_TTL_DAYS = 30;

/** 已执行过清理的 cwd:面板挂载时低频触发,同 cwd 不重复跑。 */
const prunedCwds = new Set<string>();

/** 保留策略清理:面板挂载/切换工作区时调用一次;失败静默(下次挂载重试)。 */
export function pruneRetention(cwd: string): void {
  if (prunedCwds.has(cwd)) return;
  prunedCwds.add(cwd);
  ipc
    .checkpointPrune(cwd, CKPT_KEEP, CKPT_TTL_DAYS)
    .catch(() => prunedCwds.delete(cwd));
}

/** 已执行死锚点收口的 cwd:每 cwd 每运行一次(强退恢复是启动期语义)。 */
const sealedDeadCwds = new Set<string>();

/** 死锚点新鲜度保护:不误封本运行刚打的在途锚点(误封亦无损失,封口是
 *  修订追加 —— 此宽限只是让「进行中」批不被提前翻成「待审」)。 */
const SEAL_DEAD_GRACE_MS = 60_000;

/**
 * 强退恢复:上一运行被 kill 的会话没有 sessionExited,最后一段轮次永远是
 * 开放锚点 —— 直到下次记账/收口前,它的批次在时间线上不可见。面板首次
 * 挂载时按 cwd 触发一次,随后紧跟一次清单刷新把恢复出的批带出来。
 * 失败允许重试(移除标记,下次挂载再收)。
 */
export function sealDeadTurns(cwd: string): Promise<void> {
  if (!cwd || sealedDeadCwds.has(cwd)) return Promise.resolve();
  sealedDeadCwds.add(cwd);
  return ipc
    .checkpointSealDead(cwd, SEAL_DEAD_GRACE_MS)
    .catch(() => sealedDeadCwds.delete(cwd))
    .then(() => undefined);
}

export type CkptRestoreResult = Awaited<ReturnType<typeof ipc.checkpointRestore>>;

/** 通过标记:纯标记(后端只写状态),标记后仍可回退。 */
export async function approveBatch(cwd: string, batchId: string): Promise<void> {
  await ipc.checkpointApprove(cwd, batchId);
}

export async function revertBatch(
  cwd: string,
  batchId: string,
  paths?: string[],
): Promise<CkptRestoreResult> {
  const out = await ipc.checkpointRestore(cwd, batchId, paths);
  invalidateDiff(cwd, batchId);
  return out;
}

/** 应用:把账本固化的批后像精确写回磁盘(回退的镜像);守卫可反悔。 */
export async function applyBatch(
  cwd: string,
  batchId: string,
  paths?: string[],
): Promise<CkptRestoreResult> {
  const out = await ipc.checkpointApply(cwd, batchId, paths);
  invalidateDiff(cwd, batchId);
  return out;
}
export async function undoRevertBatch(cwd: string, batchId: string): Promise<CkptRestoreResult> {
  const out = await ipc.checkpointUndoRevert(cwd, batchId);
  invalidateDiff(cwd, batchId);
  return out;
}

function invalidateDiff(cwd: string, batchId: string): void {
  diffCache.get(cwd)?.delete(batchId);
}

export function getCachedDiff(cwd: string, batchId: string): CkptPatch[] | undefined {
  return diffCache.get(cwd)?.get(batchId);
}

/** open 批 diff 强制刷新:live 新像随轮内改动推进,「占位防重」缓存只适用封口批。 */
export function refreshOpenDiff(cwd: string, batchId: string): void {
  diffCache.get(cwd)?.delete(batchId);
  loadDiff(cwd, batchId);
}

/** 批 diff 懒加载:命中缓存同步返回;否则发起 IPC(结果进缓存并 emit)。 */
export function loadDiff(cwd: string, batchId: string): CkptPatch[] | null {
  const hit = getCachedDiff(cwd, batchId);
  if (hit) return hit;
  const per = diffCache.get(cwd) ?? new Map<string, CkptPatch[]>();
  per.set(batchId, []); // 占位防重
  diffCache.set(cwd, per);
  ipc
    .checkpointBatchDiff(cwd, batchId)
    .then((patches) => {
      per.set(batchId, patches);
      emit();
    })
    .catch(() => {
      per.delete(batchId); // 失败允许重试
    });
  return null;
}

// ---- React 绑定 -----------------------------------------------------------

export function useCkptVersion(): number {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => version,
  );
}

/** 非 hook 读取(测试/非 React 上下文);React 组件走 useCkptBatches 订阅版。 */
export function getCkptBatches(cwd: string | null, sessionId: string | null): CwdCkptState {
  return cwd && sessionId ? (byKey.get(stateKey(cwd, sessionId)) ?? EMPTY) : EMPTY;
}

export function useCkptBatches(cwd: string | null, sessionId: string | null): CwdCkptState {
  useCkptVersion();
  return getCkptBatches(cwd, sessionId);
}
