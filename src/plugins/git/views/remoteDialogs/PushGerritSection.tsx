/**
 * PushDialog Gerrit 区块 —— 自 PushDialog.tsx 拆出(文件规模铁则)。
 * Push to Gerrit 开关 + topic/reviewers/cc 三输入(refspec 改
 * HEAD:refs/for/<branch>[%suffix],语义对齐 codemoss)。
 */

import { t } from "@kernel/i18n";
import { UploadSimple } from "@phosphor-icons/react";
import { OpToggle } from "./GitDialogShell";

export function PushGerritSection({
  gerrit,
  target,
  branch,
  topic,
  reviewers,
  cc,
  submitting,
  onToggle,
  onTopic,
  onReviewers,
  onCc,
}: {
  gerrit: boolean;
  target: string;
  branch: string;
  topic: string;
  reviewers: string;
  cc: string;
  submitting: boolean;
  onToggle: () => void;
  onTopic: (v: string) => void;
  onReviewers: (v: string) => void;
  onCc: (v: string) => void;
}) {
  return (
    <div className="mt-3">
      <OpToggle
        active={gerrit}
        icon={<UploadSimple className="h-3.5 w-3.5" aria-hidden />}
        label="Push to Gerrit"
        disabled={submitting}
        onToggle={onToggle}
      />
      {gerrit && (
        <div className="mt-2 rounded-md border border-(--tmd-border) bg-(--tmd-bg-sunken) p-2.5">
          <div className="text-xs text-(--tmd-fg-muted)">
            {t("将推送到 {ref}。", { ref: `refs/for/${target.trim() || branch}` })}
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <GerritInput label="Topic" value={topic} onChange={onTopic} disabled={submitting} />
            <GerritInput label="Reviewers" value={reviewers} onChange={onReviewers} disabled={submitting} placeholder={t("用户名,逗号分隔")} />
            <GerritInput label="CC" value={cc} onChange={onCc} disabled={submitting} placeholder={t("用户名,逗号分隔")} />
          </div>
        </div>
      )}
    </div>
  );
}

function GerritInput({
  label,
  value,
  placeholder,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-(--tmd-fg-muted)">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className="w-full rounded border border-(--tmd-border) bg-transparent px-2 py-1 font-mono text-xs text-(--tmd-fg) placeholder:text-(--tmd-fg-faint) focus:border-(--tmd-accent) focus:outline-none disabled:opacity-50"
      />
    </label>
  );
}
