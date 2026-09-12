/**
 * PushDialog 拆件 —— hero tokens / 推送历史 / 远端与目标分支选择区
 * (no-high-complexity 降分支 + 文件规模铁则):对话框主体只留状态编排。
 */

import { t } from "@kernel/i18n";
import { Cloud, GitBranch, ClockClockwise } from "@phosphor-icons/react";
import { BranchCombobox, PickerField, RemotePicker } from "./GitPicker";
import { isSamePushTarget, type PushTargetEntry } from "./pushHistory";


/** 推送历史(会话内存):胶囊按钮,当前目标命中即高亮;空历史不渲染。 */
export function PushHistoryRows({
  history,
  remote,
  target,
  gerrit,
  submitting,
  onApply,
}: {
  history: PushTargetEntry[];
  remote: string;
  target: string;
  gerrit: boolean;
  submitting: boolean;
  onApply: (entry: PushTargetEntry) => void;
}) {
  if (history.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      <span className="flex items-center gap-1 text-xs text-(--tmd-fg-muted)">
        <ClockClockwise className="h-[0.875rem] w-[0.875rem]" aria-hidden />
        {t("推送历史")}
      </span>
      {history.map((h) => (
        <button
          key={`${h.remote}\0${h.branch}\0${h.gerrit}`}
          type="button"
          disabled={submitting}
          onClick={() => onApply(h)}
          className={`flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[0.6875rem] disabled:opacity-50 ${
            isSamePushTarget(h, { remote: remote.trim(), branch: target.trim(), gerrit })
              ? "bg-(--tmd-accent-soft) text-(--tmd-accent)"
              : "bg-(--tmd-bg-sunken) text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover)"
          }`}
        >
          {h.remote} -&gt; {h.branch}
          {h.gerrit && <span className="not-italic text-(--tmd-accent)">Gerrit</span>}
        </button>
      ))}
    </div>
  );
}

/** 远端 / 目标远端分支双列选择区。 */
export function TargetPickers({
  remotes,
  remote,
  onRemote,
  target,
  leafs,
  branch,
  submitting,
  onTarget,
}: {
  remotes: string[];
  remote: string;
  onRemote: (r: string) => void;
  target: string;
  leafs: string[];
  branch: string;
  submitting: boolean;
  onTarget: (t: string) => void;
}) {
  return (
    <div className="mt-3 grid grid-cols-2 gap-3">
      <div>
        <PickerField icon={<Cloud className="h-[0.875rem] w-[0.875rem]" aria-hidden />} label={t("远端")} />
        <RemotePicker remotes={remotes} value={remote} disabled={submitting} onPick={onRemote} />
      </div>
      <div>
        <PickerField icon={<GitBranch className="h-[0.875rem] w-[0.875rem]" aria-hidden />} label={t("目标远端分支")} />
        <BranchCombobox
          value={target}
          placeholder={branch || "main"}
          options={leafs}
          disabled={submitting}
          onChange={onTarget}
        />
      </div>
    </div>
  );
}
