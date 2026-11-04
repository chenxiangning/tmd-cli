/**
 * 抽屉文件 diff 检索与绝对路径拼装(2026-10-20 修两案):
 * - rollup.batches 只存会话最近批 id,文件可能属该会话早前轮 → 首选批未中时
 *   按 checkpointList 枚举账本,取含该路径的最近封口批再取 patch。
 * - rollup 文件键 = cwd 相对路径,系统打开/定位须先拼会话 cwd 成绝对路径。
 */
import { ipc, type CkptPatch } from "@kernel/ipc";
import type { FootprintDay } from "./types";

/** 文件行 diff 检索钥:cwd 取首 ref 会话;batchId = rollup 最近批(可能不含本文件)。 */
export function fileBatch(
  rollup: FootprintDay | null,
  refs: string[],
): { cwd: string; batchId: string | null; sids: string[] } | null {
  if (!rollup) return null;
  const cwd = refs.map((sid) => rollup.sessions[sid]?.cwd).find(Boolean);
  if (!cwd) return null;
  return { cwd, batchId: refs.map((sid) => rollup.batches[sid]).find(Boolean) ?? null, sids: refs };
}

/** 拉某批 diff 并定位目标文件;命令失败/批内无此路径 = null(调用方降级)。 */
export async function loadPatch(cwd: string, batchId: string, path: string): Promise<CkptPatch | null> {
  try {
    const patches = await ipc.checkpointBatchDiff(cwd, batchId);
    return patches.find((p) => p.path === path) ?? null;
  } catch {
    return null;
  }
}

/** 文件 patch:首选批未中(文件属早前轮)→ 逐会话枚举账本找含该路径的最近封口批。 */
export async function loadPatchForFile(
  cwd: string,
  batchId: string | null,
  sids: string[],
  path: string,
): Promise<CkptPatch | null> {
  if (batchId) {
    const direct = await loadPatch(cwd, batchId, path);
    if (direct) return direct;
  }
  for (const sid of sids) {
    try {
      const list = await ipc.checkpointList(cwd, sid);
      const bid = [...list]
        .reverse()
        .find((b) => !b.open && b.files.some((f) => f.path === path))?.id;
      if (!bid) continue;
      const patch = await loadPatch(cwd, bid, path);
      if (patch) return patch;
    } catch {
      /* 无账本/TTL 已清理,试下一会话 */
    }
  }
  return null;
}

/** rollup 文件键 = cwd 相对路径;打开/reveal 需绝对路径(首 ref 会话 cwd)。 */
export function absFilePath(rollup: FootprintDay | null, refs: string[], path: string): string {
  const cwd = refs.map((sid) => rollup?.sessions[sid]?.cwd).find(Boolean);
  return cwd ? `${cwd}/${path}` : path;
}
