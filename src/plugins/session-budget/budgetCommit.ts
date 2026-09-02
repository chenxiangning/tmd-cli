/**
 * 显示预算提交校验 —— 纯函数,无 React(项目无组件测试设施,逻辑抽此处进 vitest)。
 * 规则平移自原 BudgetPopover(openspec session-list-budget):
 * - total 须为 1–100 整数,且不小于已分配配额之和;
 * - 配额须为不超过剩余空间的非负整数;空串 = 删除预留回到均分;
 * - 写入基底一律剪除已卸载 CLI 的残留 perCli key(注册集由调用方给)。
 * 拒绝 = 返回行内提示,由调用方回退输入框并展示(不靠 sanitize 静默兜底)。
 */

import {
  SESSION_LIST_TOTAL_MAX,
  SESSION_LIST_TOTAL_MIN,
  type SessionListBudget,
} from "@kernel/settings";

/** 提交结果:ok 携带写入值;拒绝携带行内提示。 */
export type BudgetCommitResult =
  | { ok: true; value: SessionListBudget }
  | { ok: false; hint: string };

/** 写入基底:剪掉已卸载 CLI 的残留 key。 */
export function prunePerCli(
  perCli: Record<string, number>,
  registeredIds: readonly string[],
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(perCli).filter(([id]) => registeredIds.includes(id)),
  );
}

/** 已分配配额之和(按剪除残留后的基底计,残留 key 不得抬高占用)。 */
function allocatedOf(perCli: Record<string, number>): number {
  return Object.values(perCli).reduce((sum, n) => sum + n, 0);
}

/** 提交显示总数:越界/小于已分配之和 → 拒绝;合法 → 新 total + 剪残留 perCli。 */
export function commitTotal(
  budget: SessionListBudget,
  registeredIds: readonly string[],
  raw: string,
): BudgetCommitResult {
  const perCli = prunePerCli(budget.perCli, registeredIds);
  const allocated = allocatedOf(perCli);
  const n = Number(raw);
  if (
    !Number.isInteger(n) ||
    n < SESSION_LIST_TOTAL_MIN ||
    n > SESSION_LIST_TOTAL_MAX
  ) {
    return {
      ok: false,
      hint: `总数须为 ${SESSION_LIST_TOTAL_MIN}–${SESSION_LIST_TOTAL_MAX} 的整数。`,
    };
  }
  if (n < allocated) {
    return {
      ok: false,
      hint: `总数不能小于已分配配额之和(${allocated}),请先下调分类配额。`,
    };
  }
  return { ok: true, value: { total: n, perCli } };
}

/** 提交某 CLI 配额:空串删 key 回均分;负数/非整数/超剩余空间 → 拒绝;合法 → 覆盖写入。 */
export function commitQuota(
  budget: SessionListBudget,
  cliId: string,
  registeredIds: readonly string[],
  raw: string,
): BudgetCommitResult {
  const perCli = prunePerCli(budget.perCli, registeredIds);
  const othersTotal = allocatedOf(perCli) - (perCli[cliId] ?? 0);
  const next = { ...perCli };
  if (raw.trim() === "") {
    delete next[cliId];
    return { ok: true, value: { total: budget.total, perCli: next } };
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || othersTotal + n > budget.total) {
    return {
      ok: false,
      hint: `配额须为 0–${budget.total - othersTotal} 的整数(分类之和不超过总数)。`,
    };
  }
  next[cliId] = n;
  return { ok: true, value: { total: budget.total, perCli: next } };
}
