/**
 * 工作区 caption 弹窗 —— 会话列表显示预算:总数 + 按 CLI 配额。
 * 入口:侧栏「工作区」标题行右侧 icon(添加工作区旁边),portal + fixed 定位。
 *
 * 预算语义(与 kernel/settings sanitize 同规则):
 * - 总数:一个工作区内所有 CLI 分组共享的初始露出条数(1–100,默认 20);
 * - 配额:某 CLI 固定预留的条数,不变式 sum(配额) ≤ 总数;
 *   未配置的 CLI 均分剩余;显式 0 = 该 CLI 初始不露出磁盘历史;
 * - 提交即校验,越界拒绝写入 + 行内提示(不靠 sanitize 静默兜底);
 * - 清空输入 = 取消预留,回到均分;任何写入都会剪掉已卸载 CLI 的残留 key。
 * 校验逻辑抽在同目录 budgetCommit.ts(纯函数,vitest 可测)。
 * 关闭:backdrop 点击 / Escape / 右上角 X。行样式复用全局 pref-row 系。
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { host } from "@kernel/host";
import {
  SESSION_LIST_TOTAL_MAX,
  SESSION_LIST_TOTAL_MIN,
  resolveCliSessionQuota,
  updateSettings,
  useSettingsState,
} from "@kernel/settings";
import { X } from "lucide-react";
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

/** 弹窗定位:以锚点为左上,按估算尺寸在视口内夹取(同 clampMenuPosition 思路)。 */
export function clampBudgetPosition(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.min(x, window.innerWidth - 340 - 12),
    y: Math.min(y, window.innerHeight - 480 - 12),
  };
}

export function BudgetPopover({
  position,
  onClose,
}: {
  position: { x: number; y: number };
  onClose: () => void;
}) {
  const { settings } = useSettingsState();
  const { total, perCli } = settings.sessionListBudget;
  const profiles = host.getCliProfiles();
  const registeredIds = profiles.map((p) => p.id);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** 展示与校验同基底:剪掉已卸载 CLI 的残留 key(残留不得抬高已分配)。 */
  const prunedPerCli = prunePerCli(perCli, registeredIds);
  const allocated = Object.values(prunedPerCli).reduce((sum, n) => sum + n, 0);

  /** 成功即写入;失败回退输入框并展示行内提示(不静默兜底)。 */
  const applyTotal = (input: HTMLInputElement) => {
    const result = commitTotal(settings.sessionListBudget, registeredIds, input.value);
    if (result.ok) {
      setHint(null);
      updateSettings({ sessionListBudget: result.value });
    } else {
      setHint(result.hint);
      input.value = String(total);
    }
  };

  const applyQuota = (cliId: string, input: HTMLInputElement) => {
    const result = commitQuota(
      settings.sessionListBudget,
      cliId,
      registeredIds,
      input.value,
    );
    if (result.ok) {
      setHint(null);
      updateSettings({ sessionListBudget: result.value });
    } else {
      setHint(result.hint);
      const explicit = perCli[cliId];
      input.value = explicit !== undefined ? String(explicit) : "";
    }
  };

  return createPortal(
    <>
      <div className="wsmenu-backdrop" onClick={onClose} />
      <div
        className="wsbudget"
        style={{ left: position.x, top: position.y }}
        data-testid="session-list-budget-card"
      >
        <div className="wsbudget-head">
          <span className="wsbudget-title">会话列表显示预算</span>
          <button className="wsbudget-close" title="关闭" onClick={onClose}>
            <X size={14} aria-hidden />
          </button>
        </div>

        <div className="pref-row">
          <div>
            <div className="pref-title">显示总数</div>
            <div className="pref-desc">
              一个工作区内所有 CLI 分组共享的初始露出条数（
              {SESSION_LIST_TOTAL_MIN}–{SESSION_LIST_TOTAL_MAX}，默认 20）。
              已分配 {allocated} 条，剩余 {total - allocated} 条由未配置的 CLI
              均分。「更多...」仍可按需翻倍加载。
            </div>
          </div>
          <input
            key={total}
            type="number"
            min={SESSION_LIST_TOTAL_MIN}
            max={SESSION_LIST_TOTAL_MAX}
            defaultValue={total}
            aria-label="显示总数"
            className={INPUT_CLASS}
            {...wireCommit(applyTotal)}
          />
        </div>

        {profiles.map((profile) => {
          const explicit = perCli[profile.id];
          const share = resolveCliSessionQuota(
            settings.sessionListBudget,
            profile.id,
            registeredIds,
          );
          return (
            <div className="pref-row" key={profile.id}>
              <div>
                <div className="pref-title flex items-center gap-1.5">
                  {profile.renderIcon?.(14)}
                  {profile.name}
                </div>
                <div className="pref-desc">
                  固定预留的条数；留空 = 均分剩余（当前约 {share} 条），0 =
                  初始不露出历史。
                </div>
              </div>
              <input
                key={`${profile.id}:${explicit ?? "auto"}:${share}`}
                type="number"
                min={0}
                max={total}
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
    </>,
    document.body,
  );
}
