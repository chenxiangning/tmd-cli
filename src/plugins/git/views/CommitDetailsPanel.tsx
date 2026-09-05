/**
 * CommitDetailsPanel —— 分支对比详情面板(codemoss 同构复刻)。
 *
 * 选中提交后展示:摘要标题 → sha 胶囊 + 作者 + 绝对时间 → 完整 message 块 →
 * 「N 个文件 · ++X / --Y」统计 → 文件列表(状态徽标 + 路径 + 逐文件 ±)。
 * 点文件切换为单文件 patch 视图(git_commit_file_patch,顶部「← 返回」)。
 * files + message 按 sha 进程内缓存(重复选中零请求,同 codemoss 缓存语义);
 * token 防 commit 连点竞态。
 */

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { ipc, type GitCommitFile, type GitFilePatch, type GitLogEntry } from "@kernel/ipc";
import { formatAbsolute } from "@kernel/relativeTime";
import { gitErrorDisplay } from "../gitError";
import { PatchLines } from "./PatchLines";
import { STATUS_COLOR } from "./statusColor";

interface Detail {
  files: GitCommitFile[];
  message: string;
}

export function CommitDetailsPanel({
  cwd,
  commit,
}: {
  cwd: string;
  commit: GitLogEntry;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const cacheRef = useRef(new Map<string, Detail>());
  const tokenRef = useRef(0);

  useEffect(() => {
    setSelectedFile(null);
    setError(null);
    const cached = cacheRef.current.get(commit.longSha);
    if (cached) {
      setDetail(cached);
      setLoading(false);
      return;
    }
    const token = ++tokenRef.current;
    setLoading(true);
    setDetail(null);
    Promise.all([
      ipc.gitCommitFiles(cwd, commit.longSha),
      ipc.gitCommitMessage(cwd, commit.longSha),
    ])
      .then(([files, message]) => {
        if (token !== tokenRef.current) return;
        const next = { files, message };
        cacheRef.current.set(commit.longSha, next);
        setDetail(next);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (token !== tokenRef.current) return;
        setError(gitErrorDisplay(e));
        setLoading(false);
      });
  }, [cwd, commit]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-1.5 text-(--tmd-fg-faint)">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> 加载中…
      </div>
    );
  }
  if (error) {
    return <div className="p-3 text-(--tmd-diff-removed)">{error}</div>;
  }
  if (!detail) return null;

  const totalAdds = detail.files.reduce((s, f) => s + f.additions, 0);
  const totalDels = detail.files.reduce((s, f) => s + f.deletions, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {selectedFile ? (
        <FilePatchView
          cwd={cwd}
          commit={commit}
          path={selectedFile}
          onBack={() => setSelectedFile(null)}
        />
      ) : (
        <>
          <div className="shrink-0 px-3 pt-3 text-sm font-semibold text-(--tmd-fg)">
            {commit.summary || "(空消息)"}
          </div>
          <div className="flex shrink-0 items-center gap-2 px-3 pt-1.5">
            <span className="rounded bg-(--tmd-bg-sunken) px-1.5 py-0.5 font-mono text-[10px] text-(--tmd-fg-muted)">
              {commit.shortSha}
            </span>
            <span className="text-xs text-(--tmd-fg-muted)">{commit.authorName}</span>
            <span className="text-xs text-(--tmd-fg-faint)">
              {formatAbsolute(commit.authorWhen * 1000)}
            </span>
          </div>
          {detail.message && (
            <div className="mx-3 mt-2 shrink-0 whitespace-pre-wrap rounded bg-(--tmd-bg-sunken) px-2.5 py-2 text-xs leading-5 text-(--tmd-fg-muted)">
              {detail.message}
            </div>
          )}
          <div className="shrink-0 px-3 pt-2 text-xs text-(--tmd-fg-muted)">
            {detail.files.length} 个文件 ·{" "}
            <span className="text-(--tmd-diff-inserted)">++{totalAdds}</span> /{" "}
            <span className="text-(--tmd-diff-removed)">--{totalDels}</span>
          </div>
          <div className="mx-3 mb-3 mt-1.5 min-h-0 flex-1 overflow-y-auto rounded border border-(--tmd-border)">
            {detail.files.length === 0 && (
              <div className="px-2 py-3 text-center text-xs text-(--tmd-fg-faint)">
                该提交没有变更文件
              </div>
            )}
            {detail.files.map((f) => (
              <button
                key={f.path}
                onClick={() => setSelectedFile(f.path)}
                className="flex w-full min-w-0 items-center gap-2 border-b border-(--tmd-border) px-2 py-1.5 text-left text-xs last:border-b-0 hover:bg-(--tmd-bg-hover)"
                title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}
              >
                <span
                  className={`shrink-0 rounded bg-(--tmd-bg-sunken) px-1 font-mono text-[10px] ${
                    STATUS_COLOR[f.status] ?? "text-(--tmd-fg-faint)"
                  }`}
                >
                  {f.status}
                </span>
                <span className="min-w-0 flex-1 truncate text-(--tmd-fg)">{f.path}</span>
                <span className="shrink-0 font-mono text-[10px]">
                  <span className="text-(--tmd-diff-inserted)">+{f.additions}</span>
                  <span className="text-(--tmd-fg-faint)"> / </span>
                  <span className="text-(--tmd-diff-removed)">-{f.deletions}</span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** 单文件 patch 视图:返回行 + patch 主体(binary/空 patch 有各自文案)。 */
function FilePatchView({
  cwd,
  commit,
  path,
  onBack,
}: {
  cwd: string;
  commit: GitLogEntry;
  path: string;
  onBack: () => void;
}) {
  const [patch, setPatch] = useState<GitFilePatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef(0);

  useEffect(() => {
    const token = ++tokenRef.current;
    setLoading(true);
    ipc
      .gitCommitFilePatch(cwd, commit.longSha, path)
      .then((data) => {
        if (token !== tokenRef.current) return;
        setPatch(data);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (token !== tokenRef.current) return;
        setError(gitErrorDisplay(e));
        setLoading(false);
      });
  }, [cwd, commit.longSha, path]);

  return (
    <>
      <div className="flex shrink-0 items-center gap-2 border-b border-(--tmd-border) px-3 py-2">
        <button
          onClick={onBack}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-(--tmd-accent) hover:bg-(--tmd-accent-soft)"
        >
          <ArrowLeft className="h-3 w-3" /> 返回文件列表
        </button>
        <span className="min-w-0 flex-1 truncate text-xs text-(--tmd-fg)">{path}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {loading && (
          <div className="flex h-full items-center justify-center gap-1.5 text-(--tmd-fg-faint)">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> 加载中…
          </div>
        )}
        {!loading && error && <div className="text-(--tmd-diff-removed)">{error}</div>}
        {!loading && !error && patch && patch.patch.length > 0 && (
          <PatchLines text={patch.patch} />
        )}
        {!loading && !error && patch && patch.patch.length === 0 && (
          <div className="text-(--tmd-fg-faint)">
            {patch.binary ? "二进制文件,无文本差异" : "无内容差异"}
          </div>
        )}
        {!loading && !error && !patch && (
          <div className="text-(--tmd-fg-faint)">该文件在此提交中无差异</div>
        )}
      </div>
    </>
  );
}
