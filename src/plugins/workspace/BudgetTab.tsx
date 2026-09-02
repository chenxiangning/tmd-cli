/**
 * 设置面板「会话列表 / 显示预算」tab —— workspace 插件经 registerSettingsSection 贡献。
 * 总数行 + 每注册 CLI 一行配额(图标 + 名称 + 数字输入),行集动态枚举
 * host.getCliProfiles():全量 CLI 自适应,新接入 CLI 零改动出现(禁用插件不出现)。
 * 语义:留空 = 均分剩余(placeholder 显示现值),显式 0 = 初始不露出磁盘历史;
 * blur/Enter 双通道提交,校验见 budgetCommit.ts,非法拒绝 + 行内提示。
 * 样式复用 pref-card/pref-row 体系(同 BehaviorTab),零新增 CSS。
 */

import { useState } from "react";
import { host, useHost } from "@kernel/host";
import {
  SESSION_LIST_TOTAL_MAX,
  SESSION_LIST_TOTAL_MIN,
  resolveCliSessionQuota,
  updateSettings,
  useSettingsState,
} from "@kernel/settings";
import { commitQuota, commitTotal, prunePerCli } from "./budgetCommit";

const INPUT_CLASS =
  "w-20 shrink-0 rounded-md border border-(--tmd-border) bg-(--tmd-bg-input) px-2 py-1 text-right text-sm text-(--tmd-fg) outline-none";

/** blur/Enter 双通道提交(同 BehaviorTab 缓冲上限)。 */
function wireCommit(commit: (input: HTMLInputElement) => void) {
  return {
    onBlur: (e: React.FocusEvent<HTMLInputElement>) => commit(e.target),
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") commit(e.currentTarget);
    },
  };
}

export function BudgetTab() {
  useHost(); // CLI 注册表变化(插拔/禁用)时重渲行集
  const { settings } = useSettingsState();
  const budget = settings.sessionListBudget;
  const profiles = host.getCliProfiles();
  const registeredIds = profiles.map((p) => p.id);
  /** 展示与校验同基底:剪掉已卸载 CLI 的残留 key。 */
  const perCli = prunePerCli(budget.perCli, registeredIds);
  const allocated = Object.values(perCli).reduce((sum, n) => sum + n, 0);
  const [hint, setHint] = useState<string | null>(null);

  /** 成功即写入;失败回退输入框并展示行内提示(不静默兜底)。 */
  const applyTotal = (input: HTMLInputElement) => {
    const result = commitTotal(budget, registeredIds, input.value);
    if (result.ok) {
      setHint(null);
      updateSettings({ sessionListBudget: result.value });
    } else {
      setHint(result.hint);
      input.value = String(budget.total);
    }
  };

  const applyQuota = (cliId: string, input: HTMLInputElement) => {
    const result = commitQuota(budget, cliId, registeredIds, input.value);
    if (result.ok) {
      setHint(null);
      updateSettings({ sessionListBudget: result.value });
    } else {
      setHint(result.hint);
      const explicit = budget.perCli[cliId];
      input.value = explicit !== undefined ? String(explicit) : "";
    }
  };

  return (
    <div className="pref-card" data-testid="session-list-budget-card">
      <div className="pref-row">
        <div>
          <div className="pref-title">显示总数</div>
          <div className="pref-desc">
            一个工作区内所有 CLI 分组共享的初始露出条数（
            {SESSION_LIST_TOTAL_MIN}–{SESSION_LIST_TOTAL_MAX}，默认 20）。
            已分配 {allocated} 条，剩余 {budget.total - allocated} 条由未配置的
            CLI 均分。「更多...」仍可按需翻倍加载。
          </div>
        </div>
        <input
          key={budget.total}
          type="number"
          min={SESSION_LIST_TOTAL_MIN}
          max={SESSION_LIST_TOTAL_MAX}
          defaultValue={budget.total}
          aria-label="显示总数"
          className={INPUT_CLASS}
          {...wireCommit(applyTotal)}
        />
      </div>

      {profiles.map((profile) => {
        const explicit = budget.perCli[profile.id];
        const share = resolveCliSessionQuota(budget, profile.id, registeredIds);
        return (
          <div className="pref-row" key={profile.id}>
            <div>
              <div className="pref-title flex items-center gap-1.5">
                {profile.renderIcon?.(14)}
                {profile.name}
              </div>
              <div className="pref-desc">
                固定预留的条数；留空 = 均分剩余（当前约 {share}
                条），0 = 初始不露出历史。
              </div>
            </div>
            <input
              key={`${profile.id}:${explicit ?? "auto"}:${share}`}
              type="number"
              min={0}
              max={budget.total}
              placeholder={String(share)}
              defaultValue={explicit ?? ""}
              aria-label={`${profile.name} 配额`}
              className={INPUT_CLASS}
              {...wireCommit((input) => applyQuota(profile.id, input))}
            />
          </div>
        );
      })}

      {hint && (
        <div
          role="alert"
          className="px-4 pb-3 text-xs text-(--tmd-diff-removed)"
          data-testid="session-list-budget-hint"
        >
          {hint}
        </div>
      )}
    </div>
  );
}
