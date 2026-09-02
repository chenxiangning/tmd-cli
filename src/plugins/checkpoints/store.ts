/**
 * checkpoints store —— 右栏审批线面板与中央批审阅单共享的批次状态仓
 * (对齐 git 插件 panelStore 惯例:模块级 store + useSyncExternalStore)。
 *
 * 会话严格绑定:状态仓按 (cwd, sessionId) 键控,清单由后端按 sessionId 推导 ——
 * 新会话从零开始,历史批次不跨会话可见(生命周期 = 单个会话)。
 * 数据流:promptSent → captureAnchor(锚点快照) → refreshBatches;
 * 回退/反悔动作后各自 refresh。diff 按批懒加载缓存;清单不挂轮询
 * (UI 挂载期间 6s 轻刷新,保证 open 批的 live 分类跟进)。
 */

import { useSyncExternalStore } from "react";
import { ipc, type CkptBatch, type CkptPatch } from "@kernel/ipc";

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

/** 拉批次清单(幂等;并发去重靠 token 丢弃过期响应)。 */
export function refreshBatches(cwd: string, sessionId: string): Promise<void> {
  if (!cwd || !sessionId) return Promise.resolve();
  const key = stateKey(cwd, sessionId);
  setKey(key, { loading: true });
  return ipc
    .checkpointList(cwd, sessionId)
    .then((batches) => {
      byKey.set(key, { batches, loading: false, error: null, notARepo: false });
      emit();
    })
    .catch((e: unknown) => {
      byKey.set(key, {
        batches: [],
        loading: false,
        error: String(e),
        notARepo: isNotARepoError(e),
      });
      emit();
    });
}

/** 锚点快照:发送瞬间调用;失败后台重试一次,不阻塞发送路径。 */
export function captureAnchor(cwd: string, sessionId: string, prompt: string): void {
  const run = () => ipc.checkpointCapture(cwd, sessionId, prompt);
  run().catch(() => {
    window.setTimeout(() => {
      run()
        .then(() => refreshBatches(cwd, sessionId))
        .catch(() => {
          /* 两次都失败:本锚点缺失,批会并入下一批(快照对推导的自然兜底) */
        });
    }, 1500);
    return;
  });
  // 快路径:capture 完成有延迟,定时刷新也会兜住
  window.setTimeout(() => void refreshBatches(cwd, sessionId), 800);
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

export function useCkptBatches(cwd: string | null, sessionId: string | null): CwdCkptState {
  useCkptVersion();
  return cwd && sessionId ? (byKey.get(stateKey(cwd, sessionId)) ?? EMPTY) : EMPTY;
}
