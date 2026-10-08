/**
 * BatchPushDialog —— 多仓推送确认弹窗(spec 2026-10-08-git-batch-ops-design §推送确认弹窗):
 * 左列 = 可推仓勾选列表(☐ + 仓名 + ↑n;第二行完整 `branch → remote:target`,
 *  target 行内可改,覆盖值随推送下发并驱动右侧预览);
 * 右列 = 选中仓的本次推送内容(BatchPushPreview:提交清单 + 选中提交变更文件);
 * 底栏对齐单仓 PushDialog:推送标签 / 运行 Git 挂钩 + 取消 / 推送(n)。
 * 不给 force-with-lease(批量强推无逐仓确认);不给 Gerrit;remote 固定取上游所属
 *  (多 remote 仓去单仓弹窗改,批量场景上游 remote 已覆盖绝大多数)。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { t } from "@kernel/i18n";
import { DialogActions, DialogShell, OpToggle } from "@kernel/DialogShell";
import { ArrowClockwise, GitBranch, Tag, UploadSimple } from "@phosphor-icons/react";
import { splitUpstream, type AggRepo } from "../aggregateModel";
import { BatchPushPreview } from "./BatchPushPreview";

/** 行可推判定:有上游且 ahead>0;其余行禁选并给原因。 */
function eligibleOf(r: AggRepo): string | null {
  if (r.upstream == null) return t("无上游分支");
  if (r.ahead <= 0) return t("无待推提交");
  return null;
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

export function BatchPushDialog({
  repos,
  onClose,
  onConfirm,
}: {
  repos: readonly AggRepo[];
  onClose: () => void;
  /** 确认:勾选行 + 选项 + 目标分支覆盖(仅被改过的仓)。 */
  onConfirm: (
    rows: AggRepo[],
    opts: { followTags: boolean; runHooks: boolean; targetByPath: ReadonlyMap<string, { remote: string; branch: string }> },
  ) => void;
}) {
  const eligibility = useMemo(() => new Map(repos.map((r) => [r.path, eligibleOf(r)])), [repos]);
  const eligible = repos.filter((r) => eligibility.get(r.path) == null);
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(eligible[0]?.path ?? null);
  const [editing, setEditing] = useState<string | null>(null);
  const [branchByPath, setBranchByPath] = useState<Record<string, string>>({});
  const [tags, setTags] = useState(false);
  const [runHooks, setRunHooks] = useState(true);

  const checked = eligible.filter((r) => !excluded.has(r.path));
  const allChecked = eligible.length > 0 && checked.length === eligible.length;
  const selectedRepo = eligible.find((r) => r.path === selected) ?? null;

  /** 行有效目标:覆盖值 > 上游 leaf。 */
  const targetOf = (r: AggRepo): { remote: string; branch: string } => {
    const base = splitUpstream(r.upstream ?? "");
    const b = branchByPath[r.path];
    return b ? { remote: base.remote, branch: b } : base;
  };

  const confirm = () => {
    const targetByPath = new Map<string, { remote: string; branch: string }>();
    for (const r of checked) {
      if (branchByPath[r.path]) targetByPath.set(r.path, targetOf(r));
    }
    onConfirm(checked, { followTags: tags, runHooks, targetByPath });
  };

  return (
    <DialogShell
      title={t("推送全部到远端")}
      icon={<UploadSimple className="h-[0.875rem] w-[0.875rem]" aria-hidden />}
      width={1040}
      zClass="z-[1201]"
      onClose={onClose}
      footer={
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-(--tmd-border) pt-3">
          <OpToggle active={tags} icon={<Tag className="h-[0.875rem] w-[0.875rem]" aria-hidden />} label={t("推送标签")} onToggle={() => setTags((v) => !v)} />
          <OpToggle active={runHooks} icon={<ArrowClockwise className="h-[0.875rem] w-[0.875rem]" aria-hidden />} label={t("运行 Git 挂钩")} onToggle={() => setRunHooks((v) => !v)} />
          <span className="flex-1" />
          <DialogActions
            confirmLabel={t("推送({n})", { n: checked.length })}
            confirmDisabled={checked.length === 0}
            onConfirm={confirm}
            onCancel={onClose}
          />
        </div>
      }
    >
      <div className="flex min-h-0 gap-2" style={{ height: 380 }}>
        <div className="flex min-h-0 w-[46%] flex-col rounded-md border border-(--tmd-border)">
          <label className="flex shrink-0 items-center gap-2 border-b border-(--tmd-border) px-2.5 py-1.5 text-xs text-(--tmd-fg-subtle)">
            <input
              type="checkbox"
              checked={allChecked}
              ref={(el) => {
                if (el) el.indeterminate = !allChecked && checked.length > 0;
              }}
              onChange={() => setExcluded(allChecked ? new Set(eligible.map((r) => r.path)) : new Set())}
            />
            {t("已选 {n}/{m} 仓", { n: checked.length, m: eligible.length })}
          </label>
          <div className="min-h-0 flex-1 overflow-y-auto py-0.5">
            {repos.map((r) => {
              const reason = eligibility.get(r.path);
              const disabled = reason != null;
              const tgt = targetOf(r);
              const overridden = branchByPath[r.path] != null;
              return (
                <div
                  key={r.path}
                  className={`px-2.5 py-1 text-xs ${
                    disabled ? "opacity-45" : selected === r.path ? "bg-(--tmd-bg-hover)" : "hover:bg-(--tmd-bg-hover)"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      aria-label={r.name}
                      disabled={disabled}
                      checked={!disabled && !excluded.has(r.path)}
                      onChange={() => {
                        const next = new Set(excluded);
                        if (next.has(r.path)) next.delete(r.path);
                        else next.add(r.path);
                        setExcluded(next);
                      }}
                    />
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => setSelected(r.path)}
                      className="min-w-0 flex-1 cursor-pointer text-left disabled:cursor-default"
                    >
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate font-semibold">{r.name}</span>
                        {!disabled && <span className="shrink-0 text-(--tmd-diff-inserted)">↑{r.ahead}</span>}
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
                    {!disabled &&
                      (editing === r.path ? (
                        <TargetEditor
                          value={tgt.branch}
                          onCommit={(next) => {
                            setEditing(null);
                            setBranchByPath((m) => {
                              const c = { ...m };
                              if (next && next !== splitUpstream(r.upstream ?? "").branch) c[r.path] = next;
                              else delete c[r.path];
                              return c;
                            });
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          title={t("目标远端分支")}
                          aria-label={t("目标远端分支")}
                          onClick={() => {
                            setSelected(r.path);
                            setEditing(r.path);
                          }}
                          className="shrink-0 self-end rounded px-0.5 font-mono text-[11px] text-(--tmd-fg-faint) hover:bg-(--tmd-bg-active) hover:text-(--tmd-fg) hover:underline"
                        >
                          {t("改目标")}
                        </button>
                      ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        {selectedRepo != null ? (
          <BatchPushPreview cwd={selectedRepo.path} remote={targetOf(selectedRepo).remote} target={targetOf(selectedRepo).branch} ahead={selectedRepo.ahead} />
        ) : (
          <div className="grid flex-1 place-items-center rounded-md border border-(--tmd-border) text-xs text-(--tmd-fg-faint)">
            {t("选择左侧仓查看提交")}
          </div>
        )}
      </div>
    </DialogShell>
  );
}
