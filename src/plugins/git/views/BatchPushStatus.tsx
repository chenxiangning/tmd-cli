/**
 * BatchPushDialog 拆件 —— 自 BatchPushDialog.tsx 拆出(no-high-complexity + 文件规模铁则):
 * BatchRunStatus = 底栏进度/落定回执(进行中 done/total 转圈;落定 ✓ 全成 / ✗ n 仓失败);
 * RowPushBadge = 左列行尾逐仓状态(进行中/落定后 ↑n 让位:转圈/✓/✗/排队);
 * TargetEditor / BatchPushRow = 左列仓行(☐ + 仓名 + 目标行 + 行内改目标)。
 */

import { useEffect, useRef, useState } from "react";
import { t } from "@kernel/i18n";
import { DialogActions, OpToggle } from "@kernel/DialogShell";
import { Spinner } from "@kernel/Spinner";
import { ArrowClockwise, CaretDown, CaretUp, CheckCircle, GitBranch, Tag, XCircle } from "@phosphor-icons/react";
import type { AggRepo } from "../aggregateModel";
import type { BatchRunning, RowResult } from "../useBatchGitOps";

export function BatchRunStatus({
  running,
  settled,
  failCount,
}: {
  running: BatchRunning | null;
  settled: boolean;
  failCount: number;
}) {
  if (running) {
    return (
      <span className="mr-0.5 flex shrink-0 items-center gap-1 text-xs text-(--tmd-fg-muted) tabular-nums">
        <Spinner size="0.75rem" />
        {t("{op} {done}/{total}…", { op: t("推送"), done: running.done, total: running.total })}
      </span>
    );
  }
  if (!settled) return null;
  const failed = failCount > 0;
  return (
    <span
      className={`mr-0.5 flex shrink-0 items-center gap-1 text-xs ${failed ? "text-(--tmd-diff-removed)" : "text-(--tmd-diff-inserted)"}`}
    >
      {failed ? (
        <XCircle className="h-[0.875rem] w-[0.875rem]" weight="fill" aria-hidden />
      ) : (
        <CheckCircle className="h-[0.875rem] w-[0.875rem]" weight="fill" aria-hidden />
      )}
      {failed ? t("推送完成,{n} 仓失败", { n: failCount }) : t("推送完成")}
    </span>
  );
}

/** 行尾逐仓状态徽标(纯展示);undefined(非本次推送目标)由调用方回落 ↑n。
 * err 相由 BatchPushRow 的可点徽标接管(点开行内失败日志),不在此处渲染。 */
export function RowPushBadge({ st }: { st: RowResult }) {
  if (st.phase === "running") {
    return (
      <span className="flex shrink-0 items-center">
        <Spinner size="0.75rem" />
      </span>
    );
  }
  if (st.phase === "ok") {
    return (
      <CheckCircle
        className="h-[0.8125rem] w-[0.8125rem] shrink-0 text-(--tmd-diff-inserted)"
        weight="fill"
        aria-label={t("推送完成")}
      />
    );
  }
  return <span className="shrink-0 text-(--tmd-fg-faint)">{st.phase === "queued" ? "…" : "⊘"}</span>;
}

/** 底栏:开关 + 进度/落定回执 + 动作键(冻结计数/关闭语义在调用方算好,此处纯渲染)。 */
export function BatchPushFooter({
  tags,
  runHooks,
  running,
  settled,
  failCount,
  confirmCount,
  confirmDisabled,
  onToggleTags,
  onToggleHooks,
  onConfirm,
  onCancel,
}: {
  tags: boolean;
  runHooks: boolean;
  running: BatchRunning | null;
  settled: boolean;
  failCount: number;
  confirmCount: number;
  confirmDisabled: boolean;
  onToggleTags: () => void;
  onToggleHooks: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-(--tmd-border) pt-3">
      <OpToggle active={tags} icon={<Tag className="h-[0.875rem] w-[0.875rem]" aria-hidden />} label={t("推送标签")} disabled={running != null} onToggle={onToggleTags} />
      <OpToggle active={runHooks} icon={<ArrowClockwise className="h-[0.875rem] w-[0.875rem]" aria-hidden />} label={t("运行 Git 挂钩")} disabled={running != null} onToggle={onToggleHooks} />
      <span className="flex-1" />
      <BatchRunStatus running={running} settled={settled} failCount={failCount} />
      <DialogActions
        confirmLabel={t("推送({n})", { n: confirmCount })}
        confirmDisabled={confirmDisabled}
        cancelLabel={running || settled ? t("关闭") : undefined}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </div>
  );
}

/** 目标分支行内编辑:input 失焦/Enter 落定(空串 = 撤销覆盖),Esc 还原。 */
function TargetEditor({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  return (
    <input
      ref={inputRef}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onCommit(draft.trim())}
      onKeyDown={(e) => {
        /* IME 组合中不拦截(同 WorktreeManageDialog 先例):组词 Enter=选词、Esc=消候选。 */
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter") onCommit(draft.trim());
        if (e.key === "Escape") onCommit(value);
        e.stopPropagation();
      }}
      onClick={(e) => e.stopPropagation()}
      className="w-28 rounded border border-(--tmd-accent) bg-transparent px-1 font-mono text-[11px] outline-none"
      aria-label={t("目标远端分支")}
    />
  );
}

/** 行尾状态区:err 为可点徽标(展开/收起行内失败日志),其余相纯展示,无 st 回落 ↑n。 */
function RowStatusBadge({
  st,
  ahead,
  logOpen,
  onToggleLog,
}: {
  st: RowResult | undefined;
  ahead: number;
  logOpen: boolean;
  onToggleLog: () => void;
}) {
  if (!st) return <span className="shrink-0 text-(--tmd-diff-inserted)">↑{ahead}</span>;
  if (st.phase !== "err") return <RowPushBadge st={st} />;
  return (
    <button
      type="button"
      title={logOpen ? t("收起失败日志") : t("查看失败日志")}
      aria-label={logOpen ? t("收起失败日志") : t("查看失败日志")}
      onClick={onToggleLog}
      className="flex min-w-0 max-w-56 shrink items-center gap-1 text-(--tmd-diff-removed)"
    >
      <XCircle className="h-[0.8125rem] w-[0.8125rem] shrink-0" weight="fill" aria-hidden />
      <span className="truncate text-[11px]">{st.text}</span>
      {logOpen ? (
        <CaretUp className="h-2.5 w-2.5 shrink-0" aria-hidden />
      ) : (
        <CaretDown className="h-2.5 w-2.5 shrink-0" aria-hidden />
      )}
    </button>
  );
}

/** 左列仓行:☐ + 仓名/状态徽章 + `branch → remote:target` 行 + 行内改目标(interactive = 空闲态)。 */
export function BatchPushRow({
  repo: r,
  reason,
  selected,
  editing,
  st,
  tgt,
  overridden,
  checkedOn,
  interactive,
  onToggleExclude,
  onSelect,
  onEditStart,
  onEditCommit,
}: {
  repo: AggRepo;
  /** 禁选原因(无上游/无待推);null = 可推 */
  reason: string | null;
  selected: boolean;
  editing: boolean;
  /** 本次推送的行结果(进行中/落定后;非推送目标 undefined) */
  st: RowResult | undefined;
  tgt: { remote: string; branch: string };
  overridden: boolean;
  checkedOn: boolean;
  /** 空闲态才允许勾选/改目标;进行中与落定后只读 */
  interactive: boolean;
  onToggleExclude: () => void;
  onSelect: () => void;
  onEditStart: () => void;
  onEditCommit: (next: string) => void;
}) {
  const disabled = reason != null;
  const [logOpen, setLogOpen] = useState(false);
  return (
    <div
      className={`px-2.5 py-1 text-xs ${
        disabled ? "opacity-45" : selected ? "bg-(--tmd-bg-hover)" : "hover:bg-(--tmd-bg-hover)"
      }`}
    >
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          aria-label={r.name}
          disabled={disabled || !interactive}
          checked={!disabled && checkedOn}
          onChange={onToggleExclude}
          className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-(--tmd-accent) disabled:cursor-default"
        />
        <button
          type="button"
          disabled={disabled}
          onClick={onSelect}
          className="min-w-0 flex-1 cursor-pointer text-left disabled:cursor-default"
        >
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-semibold">{r.name}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-1 whitespace-nowrap font-mono text-[11px] text-(--tmd-fg-subtle)">
            {disabled ? (
              <span className="font-sans">{reason}</span>
            ) : (
              <>
                <GitBranch className="h-3 w-3 shrink-0" aria-hidden />
                <span>{r.branch}</span>
                <span>→</span>
                <span>{tgt.remote} :</span>
                <span className={overridden ? "text-(--tmd-accent)" : ""}>{tgt.branch}</span>
              </>
            )}
          </div>
        </button>
        {/* 右列:状态徽标与「改目标」上下两行 items-end,右缘对齐一条线(2026-10-09 对齐打磨)。 */}
        {!disabled && (
          <div className="flex shrink-0 flex-col items-end justify-center gap-1 self-stretch">
            <RowStatusBadge st={st} ahead={r.ahead} logOpen={logOpen} onToggleLog={() => setLogOpen((v) => !v)} />
            {interactive &&
              (editing ? (
                <TargetEditor value={tgt.branch} onCommit={onEditCommit} />
              ) : (
                <button
                  type="button"
                  title={t("目标远端分支")}
                  aria-label={t("目标远端分支")}
                  onClick={onEditStart}
                  className="rounded px-0.5 font-mono text-[11px] text-(--tmd-fg-faint) hover:bg-(--tmd-bg-active) hover:text-(--tmd-fg) hover:underline"
                >
                  {t("改目标")}
                </button>
              ))}
          </div>
        )}
      </div>
      {/* 行内失败日志抽屉:点开完整 git stderr(多行折行,超高滚动)。 */}
      {logOpen && st?.phase === "err" && (
        <pre className="mt-1 max-h-28 overflow-auto rounded border border-(--tmd-border) bg-(--tmd-bg) px-2 py-1 font-mono text-[10.5px] leading-snug break-all whitespace-pre-wrap text-(--tmd-diff-removed)">
          {st.text}
        </pre>
      )}
    </div>
  );
}
