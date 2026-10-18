/**
 * 批 diff 懒加载缓存(从 store.ts 拆出,文件规模铁则)。
 * 键与 byKey 同源(`${cwd}|${sessionId}`,批清单按会话拉取 —— cwd 键控会让
 * 跨会话差集清理误摘他在看的批,2026-09-28 评审 P1);LRU 上限 + refresh 差集。
 */
import type { CkptPatch, CkptRestorePreview } from "@kernel/ipc";
import { ipc } from "@kernel/ipc";
import { emit, stateKey } from "./store";

const diffCache = new Map<string, Map<string, CkptPatch[]>>();
export const DIFF_CACHE_PER_CWD = 24;
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
  previewCache.delete(key);
  for (const full of [...previewInflight.keys()]) {
    if (full.startsWith(`${key}·`)) previewInflight.delete(full);
  }
}

export function pruneDiffCache(key: string, batches: { id: string }[]): void {
  const alive = new Set(batches.map((b) => b.id));
  diffCache.get(key)?.forEach((_, id) => {
    if (!alive.has(id)) diffCache.get(key)?.delete(id);
  });
  /* error 行同步摘:已不在清单的批,错误短句不该滞留到 dropKey(nit)。 */
  diffErrors.get(key)?.forEach((_, id) => {
    if (!alive.has(id)) diffErrors.get(key)?.delete(id);
  });
}

/** 批 diff 拉取失败短句(显式错误态供审阅单渲染重试入口)。 */
export function getCachedDiffError(cwd: string, sessionId: string, batchId: string): string | null {
  return diffErrors.get(stateKey(cwd, sessionId))?.get(batchId) ?? null;
}

export function getCachedDiff(cwd: string, sessionId: string, batchId: string): CkptPatch[] | undefined {
  /* 读命中刷 recency(delete+set 重插入):渲染期 join 活跃读的批驻留,
     淘汰只打非活跃批 —— 否则 join 暖取与 LRU(24)互踩成自持 IPC 自旋(评审 P2)。 */
  const per = diffCache.get(stateKey(cwd, sessionId));
  const hit = per?.get(batchId);
  if (per && hit) {
    per.delete(batchId);
    per.set(batchId, hit);
  }
  return hit;
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

// ---- 恢复 dry-run 预览(042 项6)------------------------------------------
// 与批 diff 同一套缓存纪律:LRU + 在途防重。预览在 ConfirmCard 挂载时拉一次,
// 弹层内冻结不刷新;undo_revert 复用 revert 时缓存的这份,不新发 dry-run
// (feasibility §6 undo 对称裁决),故动作后不清缓存。

const previewCache = new Map<string, Map<string, CkptRestorePreview>>();
/** 拉取在途(防重,同 diffInflight 语义):整键 = stateKey + 预览键。 */
const previewInflight = new Map<string, Promise<CkptRestorePreview>>();

/** 预览键:整批 = batchId;子集 = batchId + 排序路径拼接(undo 只认整批键)。 */
export function previewKey(batchId: string, paths?: string[]): string {
  return paths?.length ? `${batchId}|${[...paths].sort().join("|")}` : batchId;
}

export function getCachedPreview(
  cwd: string,
  sessionId: string,
  key: string,
): CkptRestorePreview | undefined {
  return previewCache.get(stateKey(cwd, sessionId))?.get(key);
}

/**
 * undo 复用入口:取该批恢复时缓存的预览(整批键优先,子集键兜底 —— 回退
 * 入口常带显式 paths,键带排序路径后缀)。冻结数据,不新发 dry-run。
 */
export function getCachedPreviewForBatch(
  cwd: string,
  sessionId: string,
  batchId: string,
): CkptRestorePreview | undefined {
  const per = previewCache.get(stateKey(cwd, sessionId));
  if (!per) return undefined;
  const exact = per.get(batchId);
  if (exact) return exact;
  for (const k of per.keys()) {
    if (k.startsWith(`${batchId}|`)) return per.get(k);
  }
  return undefined;
}

/**
 * 拉取恢复预览:命中缓存直接返回;在途复用同一 Promise;失败 reject 原始
 * 错误串(卡片侧判 E_EMPTY 免弹分支 / 其余回落文案确认,不阻塞确认流)。
 */
export function loadPreview(
  cwd: string,
  sessionId: string,
  batchId: string,
  paths?: string[],
): Promise<CkptRestorePreview> {
  const key = stateKey(cwd, sessionId);
  const pkey = previewKey(batchId, paths);
  const hit = previewCache.get(key)?.get(pkey);
  if (hit) return Promise.resolve(hit);
  const full = `${key}·${pkey}`;
  const inflight = previewInflight.get(full);
  if (inflight) return inflight;
  const p = ipc
    .checkpointRestorePreview(cwd, batchId, paths)
    .then((pv) => {
      const per = previewCache.get(key) ?? new Map<string, CkptRestorePreview>();
      per.set(pkey, pv);
      previewCache.set(key, per);
      /* LRU 与批 diff 同上限;刚插入的本键不会被摘 */
      while (per.size > DIFF_CACHE_PER_CWD) {
        const oldest = per.keys().next().value;
        if (oldest === undefined || oldest === pkey) break;
        per.delete(oldest);
      }
      return pv;
    })
    .finally(() => previewInflight.delete(full));
  previewInflight.set(full, p);
  return p;
}
