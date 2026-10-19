/**
 * 变更总览纯逻辑(ChangesPanel 拆件,文件规模铁则)——
 * 跨批次按文件折叠建组 + 状态合成 + 过滤/排序/截断/汇总,零 React 零 IPC。
 * ± 一律账本口径(CkptBatchFile.additions/deletions,封口瞬间固化,回退不回缩;
 * open 轮未封口为 0),与批审阅单懒加载 diff 求和口径不同,UI footbar 双注明。
 */
import type { CkptBatch, CkptBatchFile } from "@kernel/ipc";
import { classifyRisk } from "./risk";

/** 主状态五档(药丸 + 过滤 chip 共用)。 */
export type ChangeMainState = "deleted" | "reverted" | "changed" | "committed" | "running";

/** 过滤 chip:全部 + 五态。 */
export type ChangeFilter = "all" | ChangeMainState;

/** 排序:最近批(ts 降序)| ±(账本累计行数降序)。 */
export type ChangeSort = "batch" | "pm";

/** 跨批折叠后的单文件条目:状态取「最近批」字段,±/批次数跨批累计。 */
export interface FileChangeGroup {
  path: string;
  /** 最近批(该文件最后出现的批次;行点击深链落点) */
  latestBatch: CkptBatch;
  /** 最近批中该文件的条目(状态合成唯一输入) */
  latestFile: CkptBatchFile;
  /** 该文件出现过的批次数 */
  batchCount: number;
  /** 账本口径累计(回退不回缩) */
  additions: number;
  deletions: number;
}

/**
 * 线性折叠:batches 逐批逐文件建组(Map<path, 组>),≤100 批无需索引
 * (CKPT_KEEP=100;线性扫先例 evidenceScope)。最近批 = ts 大者胜,
 * 同 ts 取 index 大者(同轮双锚罕见但确定)。
 */
export function foldFileChanges(batches: readonly CkptBatch[]): FileChangeGroup[] {
  const byPath = new Map<string, FileChangeGroup>();
  for (const b of batches) {
    for (const f of b.files) {
      const prev = byPath.get(f.path);
      if (!prev) {
        byPath.set(f.path, {
          path: f.path,
          latestBatch: b,
          latestFile: f,
          batchCount: 1,
          additions: f.additions,
          deletions: f.deletions,
        });
        continue;
      }
      prev.batchCount += 1;
      prev.additions += f.additions;
      prev.deletions += f.deletions;
      if (
        b.ts > prev.latestBatch.ts ||
        (b.ts === prev.latestBatch.ts && b.index > prev.latestBatch.index)
      ) {
        prev.latestBatch = b;
        prev.latestFile = f;
      }
    }
  }
  return [...byPath.values()];
}

/**
 * 状态合成 —— 优先级写死(0.4.0 项11 定稿,单测锁矩阵防口径漂移):
 * ① reverted → 已回退(view.rs:78 reverted 短路在 classify 之前;删后回退删除
 *    的场景最近批条目 status 仍是 D,先判 reverted 才不会误标「已删除」)
 * ② 最近批条目 status==="D" → 已删除(其后再改则最近批条目非 D,天然互斥)
 * ③ live==="changed" → 内容已变   ④ live==="committed" → 已提交
 * ⑤ live==="same" → 改动中
 * no_baseline 只出附加 chip(「无前像」),不改主态 —— 在 UI 层读 latestFile.noBaseline。
 */
export function synthesizeChange(f: CkptBatchFile): ChangeMainState {
  if (f.reverted || f.live === "reverted") return "reverted";
  if (f.status === "D") return "deleted";
  switch (f.live) {
    case "changed":
      return "changed";
    case "committed":
      return "committed";
    default:
      return "running";
  }
}

/** 可回退 = 改动中且最近批待审且有前像(与 BatchFileSection FileSections 同判据,改需同改)。 */
export function canRevertChange(g: FileChangeGroup): boolean {
  return (
    g.latestBatch.state === "pending" &&
    g.latestFile.live === "same" &&
    !g.latestFile.noBaseline
  );
}

/** 按状态 chip + 路径子串(大小写不敏感)过滤;all + 空串原样通过。 */
export function filterGroups(
  groups: readonly FileChangeGroup[],
  filter: ChangeFilter,
  q: string,
): FileChangeGroup[] {
  const needle = q.trim().toLowerCase();
  return groups.filter(
    (g) =>
      (filter === "all" || synthesizeChange(g.latestFile) === filter) &&
      (!needle || g.path.toLowerCase().includes(needle)),
  );
}

/** 排序:batch = 最近批 ts 降序(同 ts index 降序);pm = 账本 ± 合计降序(同 ± ts 降序)。 */
export function sortGroups(
  groups: readonly FileChangeGroup[],
  sort: ChangeSort,
): FileChangeGroup[] {
  const byBatch = (a: FileChangeGroup, b: FileChangeGroup) =>
    b.latestBatch.ts - a.latestBatch.ts || b.latestBatch.index - a.latestBatch.index;
  return [...groups].sort(
    sort === "pm"
      ? (a, b) =>
          b.additions + b.deletions - (a.additions + a.deletions) || byBatch(a, b)
      : byBatch,
  );
}

/** 表行截断帽(超量折叠为「还有 N 个文件」展开行)。 */
export const CHANGES_CAP = 50;

/** 行裁剪:过滤或展开即全量;无过滤浏览态截 cap(超出折叠为「还有 N 个文件」)。 */
export function capRows(
  sorted: readonly FileChangeGroup[],
  opts: { filtering: boolean; expanded: boolean },
): FileChangeGroup[] {
  return opts.filtering || opts.expanded ? [...sorted] : sorted.slice(0, CHANGES_CAP);
}

/** 摘要条口径(全会话,不随过滤变):文件数/可回退/高危/账本 ± 合计。 */
export interface ChangesSummary {
  files: number;
  revertible: number;
  highRisk: number;
  additions: number;
  deletions: number;
}

export function summarizeChanges(groups: readonly FileChangeGroup[]): ChangesSummary {
  const sum: ChangesSummary = {
    files: groups.length,
    revertible: 0,
    highRisk: 0,
    additions: 0,
    deletions: 0,
  };
  for (const g of groups) {
    if (canRevertChange(g)) sum.revertible += 1;
    if (classifyRisk(g.path) === "high") sum.highRisk += 1;
    sum.additions += g.additions;
    sum.deletions += g.deletions;
  }
  return sum;
}
