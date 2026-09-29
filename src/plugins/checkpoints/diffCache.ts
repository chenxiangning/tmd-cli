/**
 * 批 diff 懒加载缓存(从 store.ts 拆出,文件规模铁则)。
 * 键与 byKey 同源(`${cwd}|${sessionId}`,批清单按会话拉取 —— cwd 键控会让
 * 跨会话差集清理误摘他在看的批,2026-09-28 评审 P1);LRU 上限 + refresh 差集。
 */
import type { CkptPatch } from "@kernel/ipc";
import { ipc } from "@kernel/ipc";
import { emit, stateKey } from "./store";

const diffCache = new Map<string, Map<string, CkptPatch[]>>();
const DIFF_CACHE_PER_CWD = 24;
/** 拉取在途批(防重)。不向 diffCache 插占位 [] —— 空数组与「真实空 diff」
    同形,在途窗口撞上任意 emit 会闪「+0 −0/本批无差异」假态(三轮 R3-CKPT-02)。 */
const diffInflight = new Map<string, Set<string>>();
/** 拉取失败批 → 错误短句。失败必须显式可见:静默删缓存让 sealed 批永久卡
    spinner(open 批有 6s 自愈,sealed 批无任何重试入口)(三轮 R3-CKPT-01)。 */
const diffErrors = new Map<string, Map<string, string>>();

export function invalidateDiff(cwd: string, sessionId: string, batchId: string): void {
  const key = stateKey(cwd, sessionId);
  diffCache.get(key)?.delete(batchId);
  diffErrors.get(key)?.delete(batchId);
}

/** 整键清除(byKey LRU 摘键时连带):diff 缓存/在途/错误态一并丢弃。 */
export function dropKey(key: string): void {
  diffCache.delete(key);
  diffErrors.delete(key);
  diffInflight.delete(key);
}

export function pruneDiffCache(key: string, batches: { id: string }[]): void {
  const per = diffCache.get(key);
  if (!per) return;
  const alive = new Set(batches.map((b) => b.id));
  for (const id of [...per.keys()]) if (!alive.has(id)) per.delete(id);
}

/** 批 diff 拉取失败短句(显式错误态供审阅单渲染重试入口)。 */
export function getCachedDiffError(cwd: string, sessionId: string, batchId: string): string | null {
  return diffErrors.get(stateKey(cwd, sessionId))?.get(batchId) ?? null;
}

export function getCachedDiff(cwd: string, sessionId: string, batchId: string): CkptPatch[] | undefined {
  return diffCache.get(stateKey(cwd, sessionId))?.get(batchId);
}

export function refreshOpenDiff(cwd: string, sessionId: string, batchId: string): void {
  const key = stateKey(cwd, sessionId);
  diffCache.get(key)?.delete(batchId);
  diffErrors.get(key)?.delete(batchId);
  loadDiff(cwd, sessionId, batchId);
}

export function loadDiff(cwd: string, sessionId: string, batchId: string): CkptPatch[] | null {
  const key = stateKey(cwd, sessionId);
  const hit = getCachedDiff(cwd, sessionId, batchId);
  if (hit) {
    const per = diffCache.get(key);
    if (per) {
      per.delete(batchId);
      per.set(batchId, hit);
    }
    return hit;
  }
  if (diffInflight.get(key)?.has(batchId)) return null; // 在途防重
  let inflight = diffInflight.get(key);
  if (!inflight) {
    inflight = new Set<string>();
    diffInflight.set(key, inflight);
  }
  inflight.add(batchId);
  ipc
    .checkpointBatchDiff(cwd, batchId)
    .then((patches) => {
      const per = diffCache.get(key) ?? new Map<string, CkptPatch[]>();
      per.set(batchId, patches);
      diffCache.set(key, per);
      /* LRU 上限:超限摘插入序最老(本批刚插入,不会被摘) */
      while (per.size > DIFF_CACHE_PER_CWD) {
        const oldest = per.keys().next().value;
        if (oldest === undefined || oldest === batchId) break;
        per.delete(oldest);
      }
      diffInflight.get(key)?.delete(batchId);
      diffErrors.get(key)?.delete(batchId);
      emit();
    })
    .catch((e: unknown) => {
      diffInflight.get(key)?.delete(batchId);
      const msg = String(e).replace(/^E_\w+:\s*/, "");
      const errors = diffErrors.get(key) ?? new Map<string, string>();
      errors.set(batchId, msg.slice(0, 200));
      diffErrors.set(key, errors);
      emit(); // 失败显式可见 + 可重试,不静默删缓存卡 spinner
    });
  return null;
}
