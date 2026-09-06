/**
 * PushDialog —— 将提交推送到远端(复刻 codemoss push 对话框):
 * hero tokens(<branch> -> <remote>:<target> + New 徽标 + 当前分支只读)/
 * 双栏预览(本次推送提交 + 选中提交详情变更文件树,见 PushPreviewColumns)/
 * 推送历史(会话内存)/ 远端 + 目标远端分支 / Push to Gerrit(见 PushGerritSection)/
 * 推送标签 / 运行 Git 挂钩 / Force with lease / 取消-推送。
 * 预览/详情数据 hooks 见 usePushPreview(预览 180ms 防抖;详情按选中 sha 拉取)。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Cloud, GitBranch, ClockClockwise, ArrowClockwise, Repeat, Tag, UploadSimple } from "@phosphor-icons/react";
import { ipc, type GitCommitFile, type GitPushPreview, type GitRemoteRequest } from "@kernel/ipc";
import { openCommitDiffTab } from "../../commitTab";
import { BranchCombobox, PickerField, RemotePicker } from "./GitPicker";
import { DialogActions, GitDialogShell, OpToggle } from "./GitDialogShell";
import { GitOpTokens, type GitOpToken } from "./GitOpTokens";
import { PushPreviewColumns } from "./PushPreviewColumns";
import { PushGerritSection } from "./PushGerritSection";
import { useCommitDetails, usePushPreview } from "./usePushPreview";
import {
  isSamePushTarget,
  loadPushHistory,
  rememberPushTarget,
  type PushTargetEntry,
} from "./pushHistory";

type PreviewCommit = GitPushPreview["commits"][number];

export function PushDialog({
  cwd,
  branch,
  submitting,
  onClose,
  onRun,
}: {
  cwd: string;
  /** 当前分支(detached 时不打开本对话框) */
  branch: string;
  submitting: boolean;
  onClose: () => void;
  onRun: (req: GitRemoteRequest, opLabel: string) => void;
}) {
  const [remotes, setRemotes] = useState<string[]>([]);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [remote, setRemote] = useState("origin");
  const [target, setTarget] = useState(branch);
  const [tags, setTags] = useState(false);
  const [runHooks, setRunHooks] = useState(true);
  const [forceWithLease, setForceWithLease] = useState(false);
  const [gerrit, setGerrit] = useState(false);
  const [topic, setTopic] = useState("");
  const [reviewers, setReviewers] = useState("");
  const [cc, setCc] = useState("");
  const [history, setHistory] = useState<PushTargetEntry[]>(() => loadPushHistory(cwd));
  const [selectedSha, setSelectedSha] = useState<string | null>(null);

  const { preview, previewLoading, previewError } = usePushPreview(cwd, remote, target);
  const { details, detailsLoading, detailsError } = useCommitDetails(cwd, selectedSha);

  /* 打开时拉远端/远端分支;默认远端 origin(缺失也回退),目标分支默认当前分支。 */
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

  /* 目标分支候选:该远端下的叶子名。当前分支不在候选时取第一个叶子。 */
  const leafs = useMemo(
    () =>
      candidates
        .filter((c) => c.startsWith(`${remote}/`))
        .map((c) => c.slice(remote.length + 1)),
    [candidates, remote],
  );
  /* 目标仅在候选集变化或远端切换时纠正一次;依赖刻意不含 target,
   * 否则手输目标分支会被立即拉回候选首项。 */
  useEffect(() => {
    if (leafs.length > 0 && !leafs.includes(target.trim())) setTarget(leafs[0]);
  }, [leafs]);

  const commits = preview?.commits ?? [];
  const isNewTarget = preview != null && !preview.targetFound;
  const canConfirm =
    remote.trim().length > 0 &&
    target.trim().length > 0 &&
    !previewLoading &&
    previewError == null &&
    commits.length > 0;

  const applyHistory = useCallback((entry: PushTargetEntry) => {
    setRemote(entry.remote);
    setTarget(entry.branch);
    setGerrit(entry.gerrit);
  }, []);

  const confirm = () => {
    const entry: PushTargetEntry = { remote: remote.trim(), branch: target.trim(), gerrit };
    setHistory(rememberPushTarget(cwd, entry));
    onRun(
      {
        op: "push",
        remote: entry.remote,
        branch: entry.branch,
        strategy: null,
        noCommit: false,
        noVerify: !runHooks,
        forceWithLease,
        followTags: tags,
        gerrit: gerrit ? { topic: topic.trim() || null, reviewers: reviewers.trim() || null, cc: cc.trim() || null } : null,
      },
      "推送",
    );
  };

  const onFileSelect = useCallback(
    (f: GitCommitFile, commit: PreviewCommit | null) => {
      if (!commit) return;
      openCommitDiffTab({
        cwd,
        sha: commit.longSha,
        shortSha: commit.shortSha,
        summary: commit.summary,
        authorName: commit.authorName,
        authorWhen: commit.authorWhen,
        focusPath: f.path,
      });
      onClose();
    },
    [cwd, onClose],
  );

  const targetSummary = gerrit ? `refs/for/${target.trim() || branch}` : target.trim() || branch;
  const heroTokens: GitOpToken[] = [
    { kind: "branch", value: branch || "HEAD" },
    { kind: "operator", value: "->" },
    { kind: "remote", value: remote.trim() || "origin" },
    { kind: "operator", value: ":", separatorBefore: "" },
    { kind: "branch", value: targetSummary, separatorBefore: "" },
  ];

  return (
    <GitDialogShell
      title="将提交推送到远端"
      icon={<UploadSimple className="h-3.5 w-3.5" aria-hidden />}
      width={880}
      locked={submitting}
      onClose={onClose}
      footer={
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-(--tmd-border) pt-3">
          <OpToggle active={tags} icon={<Tag className="h-3.5 w-3.5" aria-hidden />} label="推送标签" disabled={submitting} onToggle={() => setTags((v) => !v)} />
          <OpToggle active={runHooks} icon={<ArrowClockwise className="h-3.5 w-3.5" aria-hidden />} label="运行 Git 挂钩" disabled={submitting} onToggle={() => setRunHooks((v) => !v)} />
          <OpToggle active={forceWithLease} icon={<Repeat className="h-3.5 w-3.5" aria-hidden />} label="Force with lease" disabled={submitting} onToggle={() => setForceWithLease((v) => !v)} />
          <span className="flex-1" />
          <DialogActions
            confirmLabel="推送"
            confirmTitle={canConfirm ? undefined : "无可推送提交,已禁用推送按钮。"}
            confirmDisabled={!canConfirm}
            submitting={submitting}
            onConfirm={confirm}
            onCancel={onClose}
          />
        </div>
      }
    >
      {/* hero */}
      <div className="mt-3 rounded-md border border-(--tmd-border) bg-(--tmd-bg-elevated) p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-1">
            <GitOpTokens tokens={heroTokens} />
            {isNewTarget && (
              <span className="ml-1 shrink-0 font-mono text-xs text-(--tmd-fg-muted)">(New)</span>
            )}
          </div>
          <code className="shrink-0 rounded bg-(--tmd-bg-sunken) px-1.5 py-0.5 font-mono text-xs text-(--tmd-fg-muted)">
            {branch || "HEAD"}
          </code>
        </div>
      </div>

      {/* 预览双栏 / 新分支态 */}
      <PushPreviewColumns
        cwd={cwd}
        branch={branch}
        remote={remote}
        target={target}
        preview={preview}
        previewLoading={previewLoading}
        previewError={previewError}
        selectedSha={selectedSha}
        onSelectSha={setSelectedSha}
        details={details}
        detailsLoading={detailsLoading}
        detailsError={detailsError}
        onFileSelect={onFileSelect}
      />

      {/* 推送历史 */}
      {history.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="flex items-center gap-1 text-xs text-(--tmd-fg-muted)">
            <ClockClockwise className="h-3.5 w-3.5" aria-hidden />
            推送历史
          </span>
          {history.map((h) => (
            <button
              key={`${h.remote}\0${h.branch}\0${h.gerrit}`}
              type="button"
              disabled={submitting}
              onClick={() => applyHistory(h)}
              className={`flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[11px] disabled:opacity-50 ${
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
      )}

      {/* 远端 / 目标远端分支 */}
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <PickerField icon={<Cloud className="h-3.5 w-3.5" aria-hidden />} label="远端" />
          <RemotePicker remotes={remotes} value={remote} disabled={submitting} onPick={setRemote} />
        </div>
        <div>
          <PickerField icon={<GitBranch className="h-3.5 w-3.5" aria-hidden />} label="目标远端分支" />
          <BranchCombobox
            value={target}
            placeholder={branch || "main"}
            options={leafs}
            disabled={submitting}
            onChange={setTarget}
          />
        </div>
      </div>

      {/* Push to Gerrit */}
      <PushGerritSection
        gerrit={gerrit}
        target={target}
        branch={branch}
        topic={topic}
        reviewers={reviewers}
        cc={cc}
        submitting={submitting}
        onToggle={() => setGerrit((v) => !v)}
        onTopic={setTopic}
        onReviewers={setReviewers}
        onCc={setCc}
      />
    </GitDialogShell>
  );
}
