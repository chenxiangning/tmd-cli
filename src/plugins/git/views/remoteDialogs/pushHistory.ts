/**
 * pushHistory —— 推送目标历史(会话内存,按 cwd 维度,上限 3 条,新条目置顶去重)。
 * codemoss 持久化到 client store;tmd-cli 无对应设施,按 spec 只留会话生命周期。
 */

export interface PushTargetEntry {
  remote: string;
  branch: string;
  gerrit: boolean;
}

const LIMIT = 3;
const history = new Map<string, PushTargetEntry[]>();

export function loadPushHistory(cwd: string): PushTargetEntry[] {
  return history.get(cwd) ?? [];
}

export function rememberPushTarget(cwd: string, entry: PushTargetEntry): PushTargetEntry[] {
  const next = [entry, ...loadPushHistory(cwd).filter((e) => !isSamePushTarget(e, entry))];
  const capped = next.slice(0, LIMIT);
  history.set(cwd, capped);
  return capped;
}

/** 测试位:清空指定 cwd 的历史(生产代码不使用)。 */
export function resetPushHistory(cwd: string): void {
  history.delete(cwd);
}

export function isSamePushTarget(a: PushTargetEntry, b: PushTargetEntry): boolean {
  return a.remote === b.remote && a.branch === b.branch && a.gerrit === b.gerrit;
}
