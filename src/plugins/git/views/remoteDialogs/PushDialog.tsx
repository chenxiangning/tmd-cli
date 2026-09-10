/**
 * PushDialog —— 将提交推送到远端(复刻 codemoss push 对话框):
 * hero tokens(<branch> -> <remote>:<target> + New 徽标 + 当前分支只读)/
 * 双栏预览(本次推送提交 + 选中提交详情变更文件树,见 PushPreviewColumns)/
 * 推送历史(会话内存)/ 远端 + 目标远端分支 / Push to Gerrit(见 PushGerritSection)/
 * 推送标签 / 运行 Git 挂钩 / Force with lease / 取消-推送。
 * 预览/详情数据 hooks 见 usePushPreview(预览 180ms 防抖;详情按选中 sha 拉取)。
 * hero tokens/推送历史/远端选择区拆至 pushDialogParts.tsx(降分支 + 文件规模铁则)。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { t } from "@kernel/i18n";
import { ArrowClockwise, Repeat, Tag, UploadSimple } from "@phosphor-icons/react";
import { ipc, type GitCommitFile, type GitPushPreview, type GitRemoteRequest } from "@kernel/ipc";
import { openCommitDiffTab } from "../../commitTab";
import { GitOpTokens } from "./GitOpTokens";
import { DialogActions, GitDialogShell, OpToggle } from "./GitDialogShell";
import { PushPreviewColumns } from "./PushPreviewColumns";
import { PushGerritSection } from "./PushGerritSection";
import { useCommitDetails, usePushPreview } from "./usePushPreview";
import { loadPushHistory, rememberPushTarget, type PushTargetEntry } from "./pushHistory";
import { PushHistoryRows, TargetPickers } from "./pushDialogParts";
import { buildPushHeroTokens, useSyncTargetToLeafs } from "./pushDialogModel";

type PreviewCommit = GitPushPreview["commits"][number];

/** 推送前置校验:远端/目标非空 + 预览就绪且无错 + 有可推送提交。 */
function canConfirmPush(
  remote: string,
  target: string,
  previewLoading: boolean,
  previewError: string | null,
  commitCount: number,
): boolean {
  return (
    remote.trim().length > 0 &&
    target.trim().length > 0 &&
    !previewLoading &&
    previewError == null &&
    commitCount > 0
  );
}


export function PushDialog({
  cwd,
  branch,
  repoName,
  submitting,
  onClose,
  onRun,
}: {
  cwd: string;
  /** 当前分支(detached 时不打开本对话框) */
  branch: string;
  repoName?: string;
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
    () => candidates.flatMap((c) => (c.startsWith(`${remote}/`) ? [c.slice(remote.length + 1)] : [])),
    [candidates, remote],
  );
  useSyncTargetToLeafs(leafs, target, setTarget);

  const commits = preview?.commits ?? [];
  const isNewTarget = preview != null && !preview.targetFound;
  const canConfirm = canConfirmPush(remote, target, previewLoading, previewError, commits.length);

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
      t("推送"),
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

  const heroTokens = buildPushHeroTokens(branch, remote, target, gerrit);

  return (
    <GitDialogShell
      title={t("将提交推送到远端")}
      icon={<UploadSimple className="h-[0.875rem] w-[0.875rem]" aria-hidden />}
      repoName={repoName}
      width={880}
      locked={submitting}
      onClose={onClose}
      footer={
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-(--tmd-border) pt-3">
          <OpToggle active={tags} icon={<Tag className="h-[0.875rem] w-[0.875rem]" aria-hidden />} label={t("推送标签")} disabled={submitting} onToggle={() => setTags((v) => !v)} />
          <OpToggle active={runHooks} icon={<ArrowClockwise className="h-[0.875rem] w-[0.875rem]" aria-hidden />} label={t("运行 Git 挂钩")} disabled={submitting} onToggle={() => setRunHooks((v) => !v)} />
          <OpToggle active={forceWithLease} icon={<Repeat className="h-[0.875rem] w-[0.875rem]" aria-hidden />} label="Force with lease" disabled={submitting} onToggle={() => setForceWithLease((v) => !v)} />
          <span className="flex-1" />
          <DialogActions
            confirmLabel={t("推送")}
            confirmTitle={canConfirm ? undefined : t("无可推送提交,已禁用推送按钮。")}
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
      <PushHistoryRows
        history={history}
        remote={remote}
        target={target}
        gerrit={gerrit}
        submitting={submitting}
        onApply={applyHistory}
      />

      {/* 远端 / 目标远端分支 */}
      <TargetPickers
        remotes={remotes}
        remote={remote}
        onRemote={setRemote}
        target={target}
        leafs={leafs}
        branch={branch}
        submitting={submitting}
        onTarget={setTarget}
      />

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
