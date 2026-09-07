/**
 * WorktreeDiffPanel —— 工作树对分支差异面板(codemoss 同构复刻:左 diff 详情 + 右文件列表)。
 *
 * 右列:状态徽标 + 路径;点选 → 左侧加载该文件 patch(git_branch_worktree_patch,
 * 按需单文件,token 防竞态)。空列表 / 未选中 / binary / 空 patch 各有文案。
 */

import { useEffect, useRef, useState } from "react";
import { t } from "@kernel/i18n";
import { CircleNotch } from "@phosphor-icons/react";
import { ipc, type GitBranchDiffFile, type GitFilePatch } from "@kernel/ipc";
import { gitErrorDisplay } from "../gitError";
import { PatchLines } from "./PatchLines";
import { STATUS_COLOR } from "./statusColor";

export function WorktreeDiffPanel({
  cwd,
  branch,
  files,
  loading,
  error,
}: {
  cwd: string;
  branch: string;
  files: GitBranchDiffFile[];
  loading: boolean;
  error: string | null;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [patch, setPatch] = useState<GitFilePatch | null>(null);
  const [patchLoading, setPatchLoading] = useState(false);
  const [patchError, setPatchError] = useState<string | null>(null);
  const tokenRef = useRef(0);

  useEffect(() => {
    setSelected(null);
    setPatch(null);
  }, [branch]);

  useEffect(() => {
    if (!selected) return;
    const token = ++tokenRef.current;
    setPatchLoading(true);
    setPatchError(null);
    ipc
      .gitBranchWorktreePatch(cwd, branch, selected)
      .then((data: GitFilePatch | null) => {
        if (token !== tokenRef.current) return;
        setPatch(data);
        setPatchLoading(false);
      })
      .catch((e: unknown) => {
        if (token !== tokenRef.current) return;
        setPatchError(gitErrorDisplay(e));
        setPatchLoading(false);
      });
  }, [cwd, branch, selected]);

  return (
    <div className="flex min-h-0 flex-1">
      {/* 左:diff 详情 */}
      <div className="min-w-0 flex-1 overflow-auto">
        {!selected && !loading && (
          <div className="flex h-full items-center justify-center text-xs text-(--tmd-fg-faint)">
            {t("选择文件查看差异")}
          </div>
        )}
        {selected && patchLoading && (
          <div className="flex h-full items-center justify-center gap-1.5 text-(--tmd-fg-faint)">
            <CircleNotch className="h-3.5 w-3.5 animate-spin" /> {t("加载中…")}
          </div>
        )}
        {selected && patchError && (
          <div className="p-3 text-(--tmd-diff-removed)">{patchError}</div>
        )}
        {selected && !patchLoading && !patchError && patch && patch.patch.length > 0 && (
          <PatchLines text={patch.patch} />
        )}
        {selected && !patchLoading && !patchError && patch && patch.patch.length === 0 && (
          <div className="p-3 text-(--tmd-fg-faint)">
            {patch.binary ? t("二进制文件,无文本差异") : t("无内容差异")}
          </div>
        )}
        {selected && !patchLoading && !patchError && !patch && (
          <div className="p-3 text-(--tmd-fg-faint)">{t("该文件相对 {branch} 无差异", { branch })}</div>
        )}
      </div>

      {/* 右:文件列表 */}
      <div className="flex w-[300px] shrink-0 flex-col border-l border-(--tmd-border)">
        <div className="shrink-0 border-b border-(--tmd-border) px-2 py-1.5 text-[10px] uppercase tracking-wider text-(--tmd-fg-faint)">
          {t("文件({n})", { n: files.length })}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1">
          {loading && (
            <div className="flex items-center justify-center gap-1.5 py-3 text-(--tmd-fg-faint)">
              <CircleNotch className="h-3.5 w-3.5 animate-spin" /> {t("加载中…")}
            </div>
          )}
          {!loading && error && (
            <div className="px-2 py-2 text-(--tmd-diff-removed)">{error}</div>
          )}
          {!loading && !error && files.length === 0 && (
            <div className="px-2 py-3 text-center text-(--tmd-fg-faint)">
              {t("工作树与该分支没有差异")}
            </div>
          )}
          {files.map((f) => (
            <button
              key={f.path}
              onClick={() => setSelected(f.path)}
              className={`flex w-full min-w-0 items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs ${
                selected === f.path
                  ? "bg-(--tmd-accent-soft)"
                  : "hover:bg-(--tmd-bg-hover)"
              }`}
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
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
