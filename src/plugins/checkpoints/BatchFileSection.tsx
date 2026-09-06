/**
 * 批审阅单文件分区 —— 自 BatchSheet.tsx 拆出(文件规模铁则)。
 *
 * 单个文件的 diff 分区:状态 chip + 路径 + ± + unified diff 行着色,
 * 默认展开可折叠;hover 露出「只回退此文件」;深链命中整卡高亮。
 * 另含居中占位 Center(非 git 仓库 / 批次消失文案)。
 */

import { useMemo, useState } from "react";
import { CaretRight, ArrowCounterClockwise } from "@phosphor-icons/react";
import type { CkptPatch } from "@kernel/ipc";

export function FileSection({
  path,
  status,
  stale,
  reverted,
  editCount,
  attribution,
  canRevert,
  patch,
  flashed,
  busy,
  onRevert,
}: {
  path: string;
  status: string;
  stale: boolean;
  reverted: boolean;
  /** 本轮 AI 写入事件计数(events 归因轨迹;git 归因 = 0 不展示) */
  editCount: number;
  attribution: "events" | "git";
  canRevert: boolean;
  patch: CkptPatch | null;
  flashed: boolean;
  busy: boolean;
  onRevert: () => void;
}) {
  const [open, setOpen] = useState(true);
  const segs = path.split("/");
  const name = segs.pop() ?? path;
  const dir = segs.length ? segs.join("/") + "/" : "";
  const chipCls =
    status === "A"
      ? "bg-(--tmd-diff-inserted)/15 text-(--tmd-diff-inserted)"
      : status === "D"
        ? "bg-(--tmd-diff-removed)/15 text-(--tmd-diff-removed)"
        : "bg-(--tmd-git-modified)/15 text-(--tmd-git-modified)";
  const lines = useMemo(() => patch?.patch.split("\n") ?? [], [patch]);
  return (
    <div
      data-file={path}
      className={`mb-2 overflow-hidden rounded border ${flashed ? "border-(--tmd-accent)" : "border-(--tmd-border)"}`}
    >
      <div className="group flex h-[30px] items-center gap-2 bg-(--tmd-bg-elevated) px-2.5 hover:bg-(--tmd-bg-hover)">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => setOpen((v) => !v)}
        >
          <CaretRight
            size={12}
            aria-hidden
            className={`flex-none text-(--tmd-fg-faint) transition-transform ${open ? "rotate-90" : ""}`}
          />
          <span className={`grid h-[15px] w-[15px] flex-none place-items-center rounded text-[10px] font-bold ${chipCls}`}>
            {status}
          </span>
          <span className="min-w-0 truncate font-mono text-[11px]">
            <b className="font-medium text-(--tmd-fg)">{name}</b>{" "}
            <span className="text-(--tmd-fg-faint)">{dir}</span>
          </span>
          {reverted && (
            <span className="flex-none rounded border border-dashed border-[#a78bfa] px-1 text-[10px] leading-[14px] text-[#a78bfa]">
              已退
            </span>
          )}
          {stale && (
            <span
              className="flex-none rounded border border-dashed border-(--tmd-fg-faint) px-1 text-[10px] leading-[14px] text-(--tmd-fg-faint)"
              title="工作区内容已偏离本批后像,不可回退,仅可对照"
            >
              内容已变
            </span>
          )}
          {editCount > 0 && attribution === "events" && (
            <span
              className="flex-none rounded border border-(--tmd-border) px-1 text-[9px] leading-[13px] text-(--tmd-fg-faint)"
              title={`AI 本轮写入该文件 ${editCount} 次(事件流轨迹,账本可审计)`}
            >
              ×{editCount}
            </span>
          )}
          {patch && (
            <span className="flex-none font-mono text-[10px]">
              <span className="text-(--tmd-diff-inserted)">+{patch.additions}</span>{" "}
              <span className="text-(--tmd-diff-removed)">−{patch.deletions}</span>
            </span>
          )}
        </button>
        {canRevert && (
          <button
            type="button"
            disabled={busy}
            className="hidden h-5 flex-none items-center gap-1 rounded border border-(--tmd-border) px-1.5 text-[10px] text-(--tmd-fg-subtle) hover:border-[rgba(167,139,250,.5)] hover:text-[#a78bfa] group-hover:flex disabled:opacity-40"
            onClick={onRevert}
          >
            <ArrowCounterClockwise size={10} aria-hidden /> 只回退此文件
          </button>
        )}
      </div>
      {open && patch && (
        <pre className="overflow-x-auto bg-(--tmd-bg-base) p-2.5 font-mono text-[11px] leading-[1.6]">
          {lines.map((line, i) => {
            const cls = line.startsWith("@@")
              ? "text-(--tmd-accent)/75"
              : line.startsWith("+")
                ? "bg-(--tmd-diff-inserted)/10 text-(--tmd-diff-inserted)"
                : line.startsWith("-")
                  ? "bg-(--tmd-diff-removed)/10 text-(--tmd-diff-removed)"
                  : "text-(--tmd-fg-subtle)";
            return (
              <span key={i} className={`${cls} block whitespace-pre`}>
                {line || " "}
              </span>
            );
          })}
        </pre>
      )}
    </div>
  );
}

export function Center({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-xs text-(--tmd-fg-faint)">
      {children}
    </div>
  );
}
