/**
 * 单方向独有提交分区 —— 可折叠头(圆点 + 集合差标注 + 计数胶囊)+ 提交卡列表。
 * 自 BranchCompareModal.tsx 拆出(文件规模铁则)。
 */

import { useState } from "react";
import { CaretDown } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import type { GitLogEntry } from "@kernel/ipc";
import { formatRelativeTime } from "@kernel/relativeTime";

export function UniqueSection({
  branch,
  other,
  label,
  commits,
  selectedSha,
  onSelect,
}: {
  branch: string;
  other: string;
  label: string;
  commits: GitLogEntry[];
  selectedSha: string | null;
  onSelect: (c: GitLogEntry) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded border border-(--tmd-border)">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full min-w-0 items-center gap-1.5 px-2 py-1.5 text-left"
        title={open ? t("收起") : t("展开")}
      >
        <CaretDown
          className={`h-3 w-3 shrink-0 text-(--tmd-fg-faint) transition-transform ${
            open ? "" : "-rotate-90"
          }`}
        />
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-(--tmd-accent)" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-(--tmd-fg)">
          {label}
          <span className="font-normal text-(--tmd-fg-faint)">({branch} \ {other})</span>
        </span>
        <span className="shrink-0 rounded-full bg-(--tmd-accent-soft) px-1.5 py-0.5 text-[0.625rem] text-(--tmd-accent)">
          {t("{n} 个提交", { n: commits.length })}
        </span>
      </button>
      {open && (
        <div className="border-t border-(--tmd-border) p-1">
          {commits.length === 0 && (
            <div className="px-2 py-3 text-center text-xs text-(--tmd-fg-faint)">
              {t("该方向无独有提交。")}
            </div>
          )}
          {commits.map((c) => {
            const active = c.longSha === selectedSha;
            return (
              <button
                key={c.longSha}
                onClick={() => onSelect(c)}
                className={`mb-1 block w-full rounded border px-2 py-1.5 text-left ${
                  active
                    ? "border-(--tmd-accent) bg-(--tmd-accent-soft)"
                    : "border-transparent hover:bg-(--tmd-bg-hover)"
                }`}
              >
                <div className="truncate text-xs font-medium text-(--tmd-fg)">
                  {c.summary || t("(空消息)")}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[0.625rem] text-(--tmd-fg-faint)">
                  <span className="font-mono">{c.shortSha}</span>
                  <span>{c.authorName}</span>
                  <span>{formatRelativeTime(c.authorWhen * 1000)}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
