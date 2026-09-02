/**
 * checkpoints store —— 右栏审批线面板与中央批审阅单共享的批次状态仓
 * (对齐 git 插件 panelStore 惯例:模块级 store + useSyncExternalStore)。
 *
 * 数据流:promptSent → captureAnchor(锚点快照) → refreshBatches;
 * 回退/反悔动作后各自 refresh。diff 按批懒加载缓存;批次清单不挂轮询
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
const byCwd = new Map<string, CwdCkptState>();
/** cwd → batchId → patches(懒加载缓存) */
const diffCache = new Map<string, Map<string, CkptPatch[]>>();

const listeners = new Set<() => void>();
let version = 0;
function emit() {
  version += 1;
  listeners.forEach((fn) => fn());
}

function setCwd(cwd: string, patch: Partial<CwdCkptState>): void {
  byCwd.set(cwd, { ...EMPTY, ...byCwd.get(cwd), ...patch });
  emit();
}

function isNotARepoError(e: unknown): boolean {
  return String(e).startsWith("E_NOT_A_REPO:");
}

/** 拉批次清单(幂等;并发去重靠 token 丢弃过期响应)。 */
export function refreshBatches(cwd: string): Promise<void> {
  if (!cwd) return Promise.resolve();
  setCwd(cwd, { loading: true });
  return ipc
    .checkpointList(cwd)
    .then((batches) => {
      byCwd.set(cwd, { batches, loading: false, error: null, notARepo: false });
      emit();
    })
    .catch((e: unknown) => {
      byCwd.set(cwd, {
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
        .then(() => refreshBatches(cwd))
        .catch(() => {
          /* 两次都失败:本锚点缺失,批会并入下一批(快照对推导的自然兜底) */
        });
    }, 1500);
    return;
  });
  // 快路径:capture 成功与否都要刷新清单(capture 完成有延迟,6s 轮询也会兜住)
  window.setTimeout(() => void refreshBatches(cwd), 800);
}

export async function revertBatch(
  cwd: string,
  batchId: string,
  paths?: string[],
): Promise<CkptRestoreResult> {
  const out = await ipc.checkpointRestore(cwd, batchId, paths);
  invalidateDiff(cwd, batchId);
  await refreshBatches(cwd);
  return out;
}
export type CkptRestoreResult = Awaited<ReturnType<typeof ipc.checkpointRestore>>;

export async function undoRevertBatch(cwd: string, batchId: string): Promise<CkptRestoreResult> {
  const out = await ipc.checkpointUndoRevert(cwd, batchId);
  invalidateDiff(cwd, batchId);
  await refreshBatches(cwd);
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

export function useCkptBatches(cwd: string | null): CwdCkptState {
  useCkptVersion();
  return (cwd ? byCwd.get(cwd) : undefined) ?? EMPTY;
}
