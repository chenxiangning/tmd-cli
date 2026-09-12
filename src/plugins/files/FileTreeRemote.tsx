/**
 * 远程工作区文件树 —— 经 kernel fileSources 协议驱动的右栏远程浏览(M1)。
 *
 * 数据完全来自活动工作区命中的 RemoteFileSource(来源插件注册;如 WSL 的
 * wslr 源走 ssh exec 通道)。本组件零来源知识:目录懒加载、文件点击组装
 * source.fileUri 走 openFileInTab(渲染规则与本地文件一致,只读)、刷新接
 * treeHandles 槽。无注册来源的工作区不会路由到这里(FileTree 判定)。
 */

import { useCallback, useEffect, useState } from "react";
import { ArrowClockwise, CaretRight } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { resolveFileVisual } from "@kernel/fileVisual";
import type { DirEntry } from "@kernel/ipc";
import type { Workspace } from "@kernel/workspace";
import type { RemoteFileSource } from "@kernel/fileSources";
import { openFileInTab } from "./openFile";
import { setActiveTreeHandles } from "./treeHandles";

/** 单行渲染:目录 = 展开箭头 + 图标;文件 = 图标 + 名(点击开渲染 tab)。 */
function RemoteRow({
  entry,
  depth,
  expanded,
  onToggle,
}: {
  entry: DirEntry;
  depth: number;
  expanded: boolean;
  onToggle: (entry: DirEntry) => void;
}) {
  const hint = resolveFileVisual(entry.name, entry.isDir, expanded);
  return (
    <button
      type="button"
      className="file-tree-row"
      style={{ paddingLeft: depth * 12 + 12 }}
      onClick={() => onToggle(entry)}
      aria-expanded={entry.isDir ? expanded : undefined}
    >
      <span className={`file-tree-icon-cell${entry.isDir ? " has-chevron" : ""}`}>
        {entry.isDir && (
          <span className={`file-tree-chevron${expanded ? " is-open" : ""}`} aria-hidden>
            <CaretRight size="0.6875rem" />
          </span>
        )}
        <span className="file-tree-icon" aria-hidden>
          <span
            className={`file-tree-icon-svg ${hint.colorClass ?? ""}`}
            dangerouslySetInnerHTML={{ __html: hint.svgHtml }}
          />
        </span>
      </span>
      <span className={`file-tree-name ${hint.colorClass ?? "text-(--tmd-fg)"}`}>{entry.name}</span>
    </button>
  );
}

export function FileTreeRemoteSource({
  workspace,
  source,
}: {
  workspace: Workspace;
  source: RemoteFileSource;
}) {
  const root = workspace.root;
  const [entries, setEntries] = useState<DirEntry[] | null>(null);
  const [expanded, setExpanded] = useState<Record<string, DirEntry[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reloadRoot = useCallback(async () => {
    setError(null);
    setEntries(null);
    try {
      setEntries(await source.listDir(workspace, root));
    } catch (e) {
      setEntries([]);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [source, workspace, root]);

  useEffect(() => {
    void reloadRoot();
  }, [reloadRoot]);

  /* 动作句柄槽:刷新可用(远程树根层重拉);新建/文件夹在远程树上出 M1 提示(不静默)。 */
  useEffect(() => {
    setActiveTreeHandles({
      reload: reloadRoot,
      newFile: () => setNotice(t("远程文件暂不支持在文件树新建(M1):请经终端会话操作")),
      newFolder: () => setNotice(t("远程文件暂不支持在文件树新建(M1):请经终端会话操作")),
    });
    return () => setActiveTreeHandles(null);
  }, [reloadRoot]);

  const toggle = useCallback(
    (entry: DirEntry) => {
      setNotice(null);
      if (!entry.isDir) {
        openFileInTab(source.fileUri(workspace, entry.path));
        return;
      }
      if (expanded[entry.path]) {
        setExpanded(({ [entry.path]: _drop, ...rest }) => rest);
        return;
      }
      void source
        .listDir(workspace, entry.path)
        .then((children) => setExpanded((prev) => ({ ...prev, [entry.path]: children })))
        .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    },
    [expanded, source, workspace],
  );

  const renderRows = (rows: DirEntry[], depth: number): React.ReactNode =>
    rows.map((e) => (
      <div key={e.path}>
        <RemoteRow entry={e} depth={depth} expanded={expanded[e.path] !== undefined} onToggle={toggle} />
        {expanded[e.path] && renderRows(expanded[e.path], depth + 1)}
      </div>
    ));

  return (
    <div className="file-tree-panel">
      <div className="file-tree-remote-head">
        <span className="file-tree-remote-dot" aria-hidden />
        <span>{source.label(workspace)}</span>
      </div>
      <div className="file-tree-list">
        {entries === null ? (
          <div className="file-tree-loading-row" role="status" aria-live="polite">
            <span className="file-tree-loading-spinner" aria-hidden>
              <ArrowClockwise size="0.75rem" />
            </span>
            <span>{t("加载中…")}</span>
          </div>
        ) : (
          renderRows(entries, 0)
        )}
        {entries?.length === 0 && !error && (
          <div className="file-tree-empty">{t("目录为空")}</div>
        )}
      </div>
      {(error || notice) && (
        <div className={error ? "file-tree-remote-err" : "file-tree-remote-note"}>
          {error ?? notice}
        </div>
      )}
    </div>
  );
}
