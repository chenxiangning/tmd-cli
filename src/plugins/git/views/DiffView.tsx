/**
 * DiffView —— 差异视图:文件列表(平铺 F 终端风 / 树形)+ 提交 composer。
 * 平铺 = git status 原文短语三段分区(spec 2026-09-05,渲染在 DiffFlatList);
 * 树形 = 目录分组列表(现状保留)。文件行点击不内联展开 patch ——
 * 统一在中央文件区开 git-diff tab(选侧规则:wt 优先,即 staged=true 仅当
 * 已暂存且工作区无叠加改动)。
 */

import { useEffect, useMemo, useState } from "react";
import { t } from "@kernel/i18n";
import { CaretDown, FileText } from "@phosphor-icons/react";
import { ipc, type GitFileStatus, type GitTotals } from "@kernel/ipc";
import type { FileListLayout } from "../panelStore";
import { openDiffTab } from "../diffTab";
import { buildTree } from "./diffTree";
import { DiffFlatList } from "./DiffFlatList";
import { gitErrorDisplay } from "../gitError";
import { GitConfirmDialog, type GitConfirmState } from "./GitConfirmDialog";
import { STATUS_COLOR } from "./statusColor";
import { FileOpenActions } from "./FileRowActions";
import { CommitComposer } from "./CommitComposer";

interface Props {
  cwd: string;
  layout: FileListLayout;
  files: GitFileStatus[];
  /** 聚合 ±行数(低频 git_totals):平铺行内展示每文件 numstat 用 */
  totals: GitTotals | null;
  prefill: { message: string; seq: number } | null;
  onMutation: () => void;
}

export function DiffView({ cwd, layout, files, totals, prefill, onMutation }: Props) {
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [confirm, setConfirm] = useState<GitConfirmState | null>(null);

  // 文件消失(已提交/还原)时同步掉勾选
  useEffect(() => {
    const live = new Set(files.map((f) => f.path));
    setChecked((prev) => {
      const next = new Set([...prev].filter((p) => live.has(p)));
      return next.size === prev.size ? prev : next;
    });
  }, [files]);

  const toggleCheck = (path: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const runStage = (paths: string[]) =>
    ipc.gitStage(cwd, paths).then(onMutation, (e) => console.warn(gitErrorDisplay(e)));
  const runUnstage = (paths: string[]) =>
    ipc.gitUnstage(cwd, paths).then(onMutation, (e) => console.warn(gitErrorDisplay(e)));
  const askDiscard = (paths: string[]) =>
    // 破坏性操作:应用内确认前置(window.confirm 在 Tauri 可能不弹即放行)
    setConfirm({
      title:
        paths.length === 1
          ? t("放弃 {path} 的工作区改动?", { path: paths[0] })
          : t("放弃 {n} 个文件的工作区改动?", { n: paths.length }),
      detail: t("工作区还原到暂存区内容,不可恢复;staged 保留,untracked 不动。"),
      confirmLabel: t("放弃改动"),
      danger: true,
      onConfirm: () =>
        ipc
          .gitDiscard(cwd, paths)
          .then(onMutation, (e) => console.warn(gitErrorDisplay(e))),
    });

  const openDiff = (file: GitFileStatus) =>
    // wt 优先:暂存后又改的复合文件,看 worktree 侧(= 勾选提交的实际内容)
    openDiffTab({
      cwd,
      path: file.path,
      staged: file.staged && !file.wt,
      status: file.status,
    });

  // 树形专用(平铺走 DiffFlatList 的三段分区)
  const rows = useMemo(() => (layout === "tree" ? buildTree(files) : []), [files, layout]);
  const stagedPaths = useMemo(() => files.filter((f) => f.staged).map((f) => f.path), [files]);

  return (
    <div className="flex h-full flex-col">
      {/* 文件列表:平铺 = F 终端风三段分区;树形 = 目录分组(现状保留) */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {files.length === 0 && (
          <div className="flex h-24 items-center justify-center text-xs text-(--tmd-fg-faint)">
            {t("工作区干净,无变更")}
          </div>
        )}
        {files.length > 0 && layout === "flat" && (
          <DiffFlatList
            cwd={cwd}
            files={files}
            checked={checked}
            totals={totals}
            onToggleCheck={toggleCheck}
            onOpen={openDiff}
            onStage={runStage}
            onUnstage={runUnstage}
            onDiscard={askDiscard}
          />
        )}
        {files.length > 0 &&
          layout === "tree" &&
          rows.map((row) =>
            "dir" in row ? (
              <div
                key={`dir:${row.dir}`}
                className="flex items-center gap-1 px-2 py-1 font-medium text-(--tmd-fg-muted)"
              >
                <CaretDown className="h-3 w-3" />
                {row.dir}
              </div>
            ) : (
              <FileRow
                cwd={cwd}
                key={row.file.path}
                file={row.file}
                depth={row.depth}
                checked={checked.has(row.file.path)}
                onToggleCheck={() => toggleCheck(row.file.path)}
                onOpen={() => openDiff(row.file)}
                onStage={() => runStage([row.file.path])}
                onUnstage={() => runUnstage([row.file.path])}
                onDiscard={() => askDiscard([row.file.path])}
              />
            ),
          )}
      </div>

      {confirm && <GitConfirmDialog state={confirm} onClose={() => setConfirm(null)} />}

      <CommitComposer
        cwd={cwd}
        checked={checked}
        stagedPaths={stagedPaths}
        prefill={prefill}
        onCommitted={() => {
          setChecked(new Set());
          onMutation();
        }}
      />
    </div>
  );
}

/* ── 文件行:勾选框 + 打开 diff(中央 tab)+ hover stage/discard ── */

function FileRow({
  file,
  cwd,
  depth,
  checked,
  onToggleCheck,
  onOpen,
  onStage,
  onUnstage,
  onDiscard,
}: {
  file: GitFileStatus;
  cwd: string;
  depth: number;
  checked: boolean;
  onToggleCheck: () => void;
  onOpen: () => void;
  onStage: () => void;
  onUnstage: () => void;
  onDiscard: () => void;
}) {
  const isConflict = file.status === "C";
  const displayStatus = file.status === "?" ? "U" : file.status;
  return (
    <div
      className="group flex items-center gap-1.5 py-1 pr-2 hover:bg-(--tmd-bg-hover)"
      style={{ paddingLeft: `${8 + depth * 16}px` }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={isConflict}
        onChange={onToggleCheck}
        onClick={(e) => e.stopPropagation()}
        title={isConflict ? t("冲突文件:请到幕布终端解决后提交") : undefined}
        className="h-3 w-3 shrink-0 accent-(--tmd-accent) disabled:opacity-40"
      />
      <button
        type="button"
        onClick={onOpen}
        title={t("{path}(点击在中间打开 diff)", { path: file.path })}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
      >
        <FileText className="h-3.5 w-3.5 shrink-0 text-(--tmd-fg-faint)" />
        <span className="min-w-0 flex-1 truncate">{depth > 0 ? file.path.slice(file.path.indexOf("/") + 1) : file.path}</span>
        <span className={`font-mono text-[10px] ${STATUS_COLOR[file.status] ?? ""}`}>
          {displayStatus}
        </span>
      </button>
      {!isConflict && (
        <span className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-60">
          <FileOpenActions cwd={cwd} file={file} />
        </span>
      )}
      {!isConflict && (
        <button
          type="button"
          onClick={file.staged ? onUnstage : onStage}
          title={file.staged ? "unstage" : "stage"}
          className="w-4 shrink-0 text-center opacity-0 hover:text-(--tmd-accent) group-hover:opacity-60"
        >
          {file.staged ? "−" : "+"}
        </button>
      )}
      {file.wt && !isConflict && (
        <button
          type="button"
          onClick={onDiscard}
          title={t("放弃工作区改动(还原到暂存区;已暂存内容保留)")}
          className="w-4 shrink-0 text-center opacity-0 hover:text-(--tmd-diff-removed) group-hover:opacity-60"
        >
          ↺
        </button>
      )}
      {isConflict && (
        <span className="shrink-0 text-[10px] text-(--tmd-diff-removed)">{t("冲突")}</span>
      )}
    </div>
  );
}

