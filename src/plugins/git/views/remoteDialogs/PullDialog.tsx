/**
 * PullDialog —— 拉取变更(复刻 codemoss pull 对话框):
 * hero(远端 -> 目标分支 + 命令预览)/ 远端 + 目标远端分支两下拉 /
 * 修改选项展开器(策略单选互斥 + --no-commit/--no-verify 独立开关,选中成可移除 chips)/
 * Intent / Will Happen / Will NOT Happen 动态解释 / Example / 取消-拉取。
 * 打开时:远端默认 origin(无远端也回退 origin),目标分支默认当前分支。
 */

import { useEffect, useMemo, useState } from "react";
import { t } from "@kernel/i18n";
import { CaretDown, Cloud, DownloadSimple, GitBranch, Cross } from "@phosphor-icons/react";
import { ipc, type GitRemoteRequest } from "@kernel/ipc";
import { DialogActions, GitDialogShell } from "./GitDialogShell";
import { GitOpTokens, type GitOpToken } from "./GitOpTokens";
import { BranchCombobox, PickerField, RemotePicker } from "./GitPicker";
import { resolvePullExplanation, type PullStrategy } from "./pullExplain";

const STRATEGIES: PullStrategy[] = ["--rebase", "--ff-only", "--no-ff", "--squash"];
const TOGGLES = ["--no-commit", "--no-verify"] as const;
type RunFn = (req: GitRemoteRequest, opLabel: string) => void;

export function PullDialog({
  cwd,
  branch,
  repoName,
  submitting,
  onClose,
  onRun,
}: {
  cwd: string;
  /** 当前分支(detached 时为空串) */
  branch: string;
  repoName?: string;
  submitting: boolean;
  onClose: () => void;
  onRun: RunFn;
}) {
  const [remotes, setRemotes] = useState<string[]>([]);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [remote, setRemote] = useState("origin");
  const [target, setTarget] = useState(branch);
  const [strategy, setStrategy] = useState<PullStrategy | null>(null);
  const [noCommit, setNoCommit] = useState(false);
  const [noVerify, setNoVerify] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(true);

  /* 打开时拉远端与远端分支清单;候选叶子用于默认目标与远端切换联动。 */
  useEffect(() => {
    let alive = true;
    void ipc.gitRemotes(cwd).then(
      (list) => alive && setRemotes(list),
      () => alive && setRemotes([]),
    );
    void ipc.gitBranches(cwd).then(
      (list) => alive && setCandidates(list.remote.map((b) => b.name)),
      () => alive && setCandidates([]),
    );
    return () => {
      alive = false;
    };
  }, [cwd]);

  /* 默认目标分支:当前分支在候选 → 保持;否则该远端第一个叶子。 */
  const leafsOf = (r: string) =>
    candidates.filter((c) => c.startsWith(`${r}/`)).map((c) => c.slice(r.length + 1));
  useEffect(() => {
    if (candidates.length === 0) return;
    if (candidates.includes(`${remote}/${target}`)) return;
    setTarget(leafsOf(remote)[0] ?? branch);
    // 依赖刻意不含 target/branch:仅候选集或远端变化时纠正一次,
    // 否则手输目标分支会被立即拉回候选首项
  }, [candidates, remote]);

  const selectedOptions = useMemo(
    () => [
      ...(strategy ? [strategy] : []),
      ...(noCommit ? ["--no-commit"] : []),
      ...(noVerify ? ["--no-verify"] : []),
    ],
    [strategy, noCommit, noVerify],
  );

  const explanation = resolvePullExplanation(strategy, noCommit, noVerify, {
    remote: remote.trim() || "origin",
    targetBranch: target.trim() || branch || "HEAD",
  });

  const commandTokens: GitOpToken[] = [
    { kind: "command", value: "git pull" },
    { kind: "remote", value: remote.trim() || "origin" },
    { kind: "branch", value: target.trim() || branch || "HEAD" },
    ...selectedOptions.map((o) => ({ kind: "option" as const, value: o })),
  ];

  const confirm = () =>
    onRun(
      {
        op: "pull",
        remote: remote.trim() || "origin",
        branch: target.trim() || null,
        strategy,
        noCommit,
        noVerify,
        forceWithLease: false,
        followTags: false,
        gerrit: null,
      },
      t("拉取"),
    );

  return (
    <GitDialogShell
      title={t("拉取变更")}
      icon={<DownloadSimple className="h-3.5 w-3.5" aria-hidden />}
      repoName={repoName}
      onClose={onClose}
      footer={
        <DialogActions confirmLabel={t("拉取")} submitting={submitting} onConfirm={confirm} onCancel={onClose} />
      }
    >
      {/* hero:远端 -> 目标分支 + 命令预览 */}
      <div className="mt-3 rounded-md border border-(--tmd-border) bg-(--tmd-bg-elevated) p-3">
        <div className="font-mono text-xs font-semibold text-(--tmd-fg)">
          {remote.trim() || "origin"} -&gt; {target.trim() || branch || "main"}
        </div>
        <div className="mt-1.5 rounded bg-(--tmd-bg-sunken) px-2 py-1">
          <GitOpTokens tokens={commandTokens} />
        </div>
      </div>

      {/* 远端 / 目标远端分支 */}
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <PickerField icon={<Cloud className="h-3.5 w-3.5" aria-hidden />} label={t("远端")} />
          <RemotePicker
            remotes={remotes}
            value={remote}
            disabled={submitting}
            onPick={(r) => {
              setRemote(r);
              const leafs = leafsOf(r);
              if (leafs.length > 0 && !leafs.includes(target.trim())) setTarget(leafs[0]);
            }}
          />
        </div>
        <div>
          <PickerField icon={<GitBranch className="h-3.5 w-3.5" aria-hidden />} label={t("目标远端分支")} />
          <BranchCombobox
            value={target}
            placeholder={branch || "main"}
            options={leafsOf(remote.trim())}
            disabled={submitting}
            onChange={setTarget}
          />
        </div>
      </div>

      {/* 修改选项展开器 + chips */}
      <div className="mt-3">
        <button
          type="button"
          disabled={submitting}
          onClick={() => setOptionsOpen((v) => !v)}
          className="flex w-full items-center gap-2 rounded border border-(--tmd-border) px-2 py-1.5 text-xs text-(--tmd-fg) hover:bg-(--tmd-bg-hover) disabled:opacity-50"
        >
          <span className="flex h-4 min-w-4 items-center justify-center rounded-sm bg-(--tmd-bg-sunken) px-1 text-[10px] text-(--tmd-fg-muted)">
            {selectedOptions.length > 0 ? selectedOptions.length : ""}
          </span>
          {t("修改选项")}
          <CaretDown
            className={`ml-auto h-3.5 w-3.5 text-(--tmd-fg-faint) transition-transform ${optionsOpen ? "rotate-180" : ""}`}
            aria-hidden
          />
        </button>
        {optionsOpen && (
          <div className="mt-1.5 space-y-1 rounded-md border border-(--tmd-border) p-1.5">
            {STRATEGIES.map((s) => (
              <OptionRow
                key={s}
                active={strategy === s}
                disabled={submitting}
                label={s}
                onClick={() => setStrategy((prev) => (prev === s ? null : s))}
              />
            ))}
            {TOGGLES.map((t) => (
              <OptionRow
                key={t}
                active={t === "--no-commit" ? noCommit : noVerify}
                disabled={submitting}
                label={t}
                onClick={() => (t === "--no-commit" ? setNoCommit((v) => !v) : setNoVerify((v) => !v))}
              />
            ))}
          </div>
        )}
        {selectedOptions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {selectedOptions.map((o) => (
              <button
                key={o}
                type="button"
                disabled={submitting}
                onClick={() => {
                  if (o === strategy) setStrategy(null);
                  else if (o === "--no-commit") setNoCommit(false);
                  else if (o === "--no-verify") setNoVerify(false);
                }}
                className="flex items-center gap-1 rounded-full bg-(--tmd-bg-sunken) px-2 py-0.5 font-mono text-[11px] text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover) disabled:opacity-50"
              >
                {o}
                <Cross className="h-3 w-3" aria-hidden />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Intent / Will Happen / Will NOT Happen */}
      <dl className="mt-3 space-y-2 rounded-md border border-(--tmd-border) bg-(--tmd-bg-sunken) p-3">
        <div>
          <dt className="text-xs font-semibold text-(--tmd-fg)">Intent</dt>
          <dd className="mt-0.5 text-xs leading-5 text-(--tmd-fg-muted)">{t(explanation.intent)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-(--tmd-fg)">Will Happen</dt>
          <dd>
            <ul role="status" aria-live="polite" className="mt-0.5 space-y-1">
              {explanation.rows.map((row) => (
                <li
                  key={row.code ?? row.label}
                  className={`text-xs leading-5 ${
                    row.tone === "attention"
                      ? "text-(--tmd-warn)"
                      : row.tone === "muted"
                        ? "text-(--tmd-fg-faint)"
                        : "text-(--tmd-fg-muted)"
                  }`}
                >
                  {row.code && <code className="mr-1 font-mono">{row.code}</code>}
                  {row.label && <strong className="mr-1 text-(--tmd-fg)">{t(row.label)}</strong>}
                  {t(row.text)}
                </li>
              ))}
            </ul>
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-(--tmd-fg)">Will NOT Happen</dt>
          <dd className="mt-0.5 text-xs leading-5 text-(--tmd-fg-muted)">{t(explanation.willNot)}</dd>
        </div>
      </dl>

      {/* Example:与 hero 命令预览恒一致 */}
      <div className="mt-3 rounded-md border border-(--tmd-border) p-3">
        <div className="text-xs font-semibold text-(--tmd-fg)">Example</div>
        <div className="mt-1.5">
          <GitOpTokens tokens={commandTokens} />
        </div>
      </div>
    </GitDialogShell>
  );
}

function OptionRow({
  active,
  label,
  disabled,
  onClick,
}: {
  active: boolean;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded px-2 py-1 font-mono text-xs disabled:opacity-50 ${
        active
          ? "bg-(--tmd-accent-soft) text-(--tmd-accent)"
          : "text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover)"
      }`}
    >
      <span
        className={`flex h-3.5 w-3.5 items-center justify-center rounded-sm border text-[10px] leading-none ${
          active ? "border-(--tmd-accent) bg-(--tmd-accent) text-(--tmd-accent-fg)" : "border-(--tmd-border)"
        }`}
      >
        {active ? "✓" : ""}
      </span>
      {label}
    </button>
  );
}
