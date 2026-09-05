/**
 * PushDialog —— 将提交推送到远端(复刻 codemoss push 对话框):
 * hero tokens(<branch> -> <remote>:<target> + New 徽标 + 当前分支只读)/
 * 双栏预览(本次推送提交 + 选中提交详情变更文件树)/ 推送历史(会话内存)/
 * 远端 + 目标远端分支 / Push to Gerrit(topic/reviewers/cc)/
 * 推送标签 / 运行 Git 挂钩 / Force with lease / 取消-推送。
 * 预览按 (remote, target) 180ms 防抖加载;详情按选中 sha 拉取;文件点击开中央提交 diff tab。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Cloud, FileText, GitBranch, GitCommitHorizontal, History, RefreshCw, Repeat, Tag, Upload } from "lucide-react";
import { ipc, type GitCommitFile, type GitPushPreview, type GitRemoteRequest } from "@kernel/ipc";
import { formatRelativeTime } from "@kernel/relativeTime";
import { openCommitDiffTab } from "../../commitTab";
import { BranchCombobox, PickerField, RemotePicker } from "./GitPicker";
import { DialogActions, GitDialogShell, OpToggle } from "./GitDialogShell";
import { GitOpTokens, type GitOpToken } from "./GitOpTokens";
import { CommitFileTree } from "./CommitFileTree";
import { gitErrorDisplay } from "../../gitError";
import {
  isSamePushTarget,
  loadPushHistory,
  rememberPushTarget,
  type PushTargetEntry,
} from "./pushHistory";

const PREVIEW_LIMIT = 120;
const PREVIEW_DEBOUNCE_MS = 180;


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

  const [preview, setPreview] = useState<GitPushPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [selectedSha, setSelectedSha] = useState<string | null>(null);
  const [details, setDetails] = useState<GitCommitFile[] | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);

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

  /* 预览:目标变化 180ms 防抖;token 竞态防护。 */
  const previewToken = useRef(0);
  useEffect(() => {
    const t = target.trim();
    if (!t) {
      setPreview(null);
      setPreviewError(null);
      setPreviewLoading(false);
      return;
    }
    const my = ++previewToken.current;
    setPreviewLoading(true);
    setPreviewError(null);
    const timer = window.setTimeout(() => {
      ipc.gitPushPreview(cwd, remote.trim() || "origin", t, PREVIEW_LIMIT).then(
        (data) => {
          if (my !== previewToken.current) return;
          setPreview(data);
          setPreviewLoading(false);
        },
        (e: unknown) => {
          if (my !== previewToken.current) return;
          setPreview(null);
          setPreviewLoading(false);
          setPreviewError(gitErrorDisplay(e));
        },
      );
    }, PREVIEW_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [cwd, remote, target]);

  /* 选中提交 → 详情(变更文件清单)。 */
  useEffect(() => {
    if (!selectedSha) {
      setDetails(null);
      setDetailsError(null);
      return;
    }
    let alive = true;
    setDetailsLoading(true);
    setDetailsError(null);
    ipc.gitCommitFiles(cwd, selectedSha).then(
      (files) => {
        if (!alive) return;
        setDetails(files);
        setDetailsLoading(false);
      },
      (e: unknown) => {
        if (!alive) return;
        setDetails(null);
        setDetailsLoading(false);
        setDetailsError(gitErrorDisplay(e));
      },
    );
    return () => {
      alive = false;
    };
  }, [cwd, selectedSha]);

  const commits = preview?.commits ?? [];
  const selected = useMemo(
    () => commits.find((c) => c.longSha === selectedSha) ?? null,
    [commits, selectedSha],
  );
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
    (f: GitCommitFile) => {
      if (!selected) return;
      openCommitDiffTab({
        cwd,
        sha: selected.longSha,
        shortSha: selected.shortSha,
        summary: selected.summary,
        authorName: selected.authorName,
        authorWhen: selected.authorWhen,
        focusPath: f.path,
      });
      onClose();
    },
    [cwd, selected, onClose],
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
      icon={<Upload className="h-3.5 w-3.5" aria-hidden />}
      width={880}
      locked={submitting}
      onClose={onClose}
      footer={
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-(--tmd-border) pt-3">
          <OpToggle active={tags} icon={<Tag className="h-3.5 w-3.5" aria-hidden />} label="推送标签" disabled={submitting} onToggle={() => setTags((v) => !v)} />
          <OpToggle active={runHooks} icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden />} label="运行 Git 挂钩" disabled={submitting} onToggle={() => setRunHooks((v) => !v)} />
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
      <div className="mt-3 grid grid-cols-2 gap-3">
        <PreviewPane
          title="本次推送提交"
          count={commits.length}
          loading={previewLoading}
          error={previewError}
          hasMore={preview?.hasMore ?? false}
        >
          {isNewTarget && !previewLoading && !previewError ? (
            <div className="px-1 py-2 text-xs leading-5 text-(--tmd-fg-muted)">
              <div className="font-medium text-(--tmd-fg)">新分支首次推送</div>
              <div className="mt-1">
                本地未找到目标引用 {remote.trim() || "origin"}/{target.trim() || branch},将按新分支首次推送处理:创建远端分支并推送当前分支提交。
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto">
              {commits.map((c) => (
                <button
                  key={c.longSha}
                  type="button"
                  onClick={() => setSelectedSha(c.longSha)}
                  className={`rounded px-1.5 py-1 text-left text-xs ${
                    selectedSha === c.longSha
                      ? "bg-(--tmd-accent-soft)"
                      : "hover:bg-(--tmd-bg-hover)"
                  }`}
                >
                  <div className="truncate font-medium text-(--tmd-fg)">
                    {c.summary || "(无提交信息)"}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-(--tmd-fg-muted)">
                    <code className="font-mono">{c.shortSha}</code>
                    <em className="not-italic">{c.authorName || "未知"}</em>
                    <time>{formatRelativeTime(c.authorWhen * 1000)}</time>
                  </div>
                </button>
              ))}
              {preview?.hasMore && (
                <div className="px-1.5 py-1 text-[11px] text-(--tmd-fg-faint)">
                  仅展示最近 {PREVIEW_LIMIT} 条提交。
                </div>
              )}
            </div>
          )}
        </PreviewPane>

        <PreviewPane
          title="选中提交详情"
          count={details?.length ?? 0}
          loading={detailsLoading}
          error={detailsError}
          hasMore={false}
        >
          {!selectedSha ? (
            <div className="px-1 py-2 text-xs text-(--tmd-fg-faint)">请选择一条提交查看详情。</div>
          ) : (
            details && (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="px-1 text-xs leading-5 text-(--tmd-fg-muted)">
                  <div className="truncate font-medium text-(--tmd-fg)">
                    {selected?.summary || "(无提交信息)"}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px]">
                    <code className="font-mono">{selected?.longSha.slice(0, 16) ?? selectedSha.slice(0, 16)}…</code>
                    <em className="not-italic">{selected?.authorName || "未知"}</em>
                    <time>
                      {new Date((selected?.authorWhen ?? 0) * 1000).toLocaleString()}
                    </time>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-1 px-1 text-xs font-medium text-(--tmd-fg)">
                  <GitBranch className="h-3.5 w-3.5" aria-hidden />
                  变更文件
                  <i className="ml-auto not-italic text-(--tmd-fg-muted)">{details.length}</i>
                </div>
                <div className="mt-1 min-h-0 flex-1 overflow-auto rounded border border-(--tmd-border) p-1">
                  <CommitFileTree
                    rootName={cwd.split("/").filter(Boolean).pop() ?? ""}
                    files={details}
                    selectedPath={null}
                    onSelect={onFileSelect}
                  />
                </div>
              </div>
            )
          )}
        </PreviewPane>
      </div>

      {/* 推送历史 */}
      {history.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="flex items-center gap-1 text-xs text-(--tmd-fg-muted)">
            <History className="h-3.5 w-3.5" aria-hidden />
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
      <div className="mt-3">
        <OpToggle
          active={gerrit}
          icon={<Upload className="h-3.5 w-3.5" aria-hidden />}
          label="Push to Gerrit"
          disabled={submitting}
          onToggle={() => setGerrit((v) => !v)}
        />
        {gerrit && (
          <div className="mt-2 rounded-md border border-(--tmd-border) bg-(--tmd-bg-sunken) p-2.5">
            <div className="text-xs text-(--tmd-fg-muted)">
              将推送到 <code className="font-mono text-(--tmd-fg)">refs/for/{target.trim() || branch}</code>。
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <GerritInput label="Topic" value={topic} onChange={setTopic} disabled={submitting} />
              <GerritInput label="Reviewers" value={reviewers} onChange={setReviewers} disabled={submitting} placeholder="用户名,逗号分隔" />
              <GerritInput label="CC" value={cc} onChange={setCc} disabled={submitting} placeholder="用户名,逗号分隔" />
            </div>
          </div>
        )}
      </div>
    </GitDialogShell>
  );
}

function PreviewPane({
  title,
  count,
  loading,
  error,
  hasMore,
  children,
}: {
  title: string;
  count: number;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-64 min-h-0 flex-col rounded-md border border-(--tmd-border) bg-(--tmd-bg-elevated) p-2">
      <div className="flex shrink-0 items-center gap-1 px-1 text-xs font-medium text-(--tmd-fg)">
        {title === "本次推送提交" ? (
          <GitCommitHorizontal className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <FileText className="h-3.5 w-3.5" aria-hidden />
        )}
        {title}
        <strong className="ml-auto font-semibold text-(--tmd-fg-muted)">
          {title === "本次推送提交" && hasMore ? `${count}+` : count}
        </strong>
      </div>
      <div className="mt-1 flex min-h-0 flex-1 flex-col">
        {loading ? (
          <div className="px-1 py-2 text-xs text-(--tmd-fg-faint)">
            {title === "本次推送提交" ? "正在加载推送预览提交..." : "正在加载提交详情..."}
          </div>
        ) : error ? (
          <div className="px-1 py-2 text-xs leading-5 text-(--tmd-diff-removed)">{error}</div>
        ) : (
          children
        )}
      </div>
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
