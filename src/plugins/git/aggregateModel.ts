/**
 * aggregateModel —— Git 面板聚合模式(「全部」)的纯函数面
 * (spec 2026-10-08-git-batch-ops-design):跨工作区仓清单扁平去重、
 * 批量操作目标选择、行级结果文案。无 React / 无 ipc,供
 * useAggregateRepos / useBatchGitOps / AggregateReposView 共用与单测。
 */

import { t } from "@kernel/i18n";
import type { GitRemoteOpReport, GitRepoSummary } from "@kernel/ipc";

/** 聚合行:仓摘要 + 轻量状态(branch/dirty/ahead/behind);dirty=-1 = 状态未取到。 */
export interface AggRepo extends GitRepoSummary {
  dirty: number;
  ahead: number;
  behind: number;
  upstream: string | null;
}

export interface AggGroup {
  wsId: string;
  wsName: string;
  root: string;
  repos: AggRepo[];
  /** 该工作区扫描超 32 仓被截断(git_repos_scan 上限)。 */
  truncated: boolean;
}

export type BatchOp = "fetch" | "pull" | "push";

/** 聚合段控可见门槛:本机工作区 ≥2 或当前工作区多仓(单仓单工作区用户零新 UI)。 */
export function canAggregate(
  workspaces: readonly { wsl?: { hostId: string | null } | null }[],
  repoCount: number,
): boolean {
  return workspaces.filter((w) => !w.wsl?.hostId).length >= 2 || repoCount > 1;
}

/** 跨工作区扁平去重:嵌套工作区会把同一仓重复扫出,按 path 去重,首个工作区胜出。 */
export function dedupeGroups(
  scans: readonly { wsId: string; wsName: string; root: string; truncated: boolean; repos: readonly GitRepoSummary[] }[],
): AggGroup[] {
  const seen = new Set<string>();
  const groups: AggGroup[] = [];
  for (const scan of scans) {
    const repos: AggRepo[] = [];
    for (const r of scan.repos) {
      if (seen.has(r.path)) continue;
      seen.add(r.path);
      repos.push({ ...r, dirty: -1, ahead: 0, behind: 0, upstream: null });
    }
    if (repos.length > 0) groups.push({ ...scan, repos });
  }
  return groups;
}

/**
 * 批量目标选择:fetch = 全部仓;pull = 有上游(无上游没有可拉来源,直接标跳过);
 * push = 有上游且 ahead>0(无待推提交标跳过,不打无意义网络请求)。
 * 返回执行清单与跳过原因(按 path),跳过行不进执行队列。
 */
export function selectTargets(
  op: BatchOp,
  repos: readonly AggRepo[],
): { targets: AggRepo[]; skipped: ReadonlyMap<string, string> } {
  const skipped = new Map<string, string>();
  const targets: AggRepo[] = [];
  for (const r of repos) {
    if (op !== "fetch" && r.upstream == null) {
      skipped.set(r.path, t("无上游分支"));
      continue;
    }
    if (op === "push" && r.ahead <= 0) {
      skipped.set(r.path, t("无待推提交"));
      continue;
    }
    targets.push(r);
  }
  return { targets, skipped };
}

/** upstream "origin/main" → {remote, branch}(无 "/" 兜底 origin,与 PushDialog 缺省远端一致)。 */
export function splitUpstream(upstream: string): { remote: string; branch: string } {
  const i = upstream.indexOf("/");
  return i > 0
    ? { remote: upstream.slice(0, i), branch: upstream.slice(i + 1) }
    : { remote: "origin", branch: upstream };
}

/** 行级结果文案(紧凑,区别于远端对话框长句;失败文案由执行器另行生成)。 */
export function formatRowResult(op: BatchOp, r: GitRemoteOpReport): string {
  if (r.upToDate) return t("已是最新");
  if (op === "fetch") return t("更新 {n} 个引用", { n: r.refs });
  if (op === "push") return t("已推 {n} 个提交", { n: r.commits });
  return r.commits > 0 ? t("合入 {n} 个提交", { n: r.commits }) : t("已是最新");
}
