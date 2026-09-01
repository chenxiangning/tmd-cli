/**
 * files 插件：右栏文件树 + 文件预览（中央 tab 化中，overlay 仅兜底）。
 * 目录点击懒展开；文件点击经 fs_read_file 拉内容。
 */

import { useEffect, useState } from "react";
import { ipc, type DirEntry } from "@kernel/ipc";
import type { Plugin } from "@kernel/plugin";

// ---- 预览状态（插件内部 store） --------------------------------------

interface PreviewState {
  path: string;
  content: string | null;
  error: string | null;
}

let preview: PreviewState | null = null;
const previewListeners = new Set<() => void>();

function setPreview(next: PreviewState | null) {
  preview = next;
  previewListeners.forEach((fn) => fn());
}

function openFile(path: string) {
  setPreview({ path, content: null, error: null });
  ipc.fsReadFile(path).then(
    (content) => setPreview({ path, content, error: null }),
    (e) => setPreview({ path, content: null, error: String(e) }),
  );
}

function FilePreviewOverlay() {
  // 注：本轮改造预期迁移到中央 tab 渲染；overlay 临时保留，最小可用兜底。
  if (!preview) return null;
  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={() => setPreview(null)}
    >
      <div
        className="flex h-4/5 w-3/4 flex-col rounded border border-neutral-700 bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-neutral-800 px-3">
          <span className="truncate text-xs text-neutral-400">{preview.path}</span>
          <button
            className="rounded px-2 py-0.5 text-xs hover:bg-neutral-800"
            onClick={() => setPreview(null)}
          >
            关闭
          </button>
        </div>
        <pre className="min-h-0 flex-1 overflow-auto p-3 text-xs leading-5 text-neutral-300">
          {preview.error ? `⚠ ${preview.error}` : (preview.content ?? "加载中…")}
        </pre>
      </div>
    </div>
  );
}

// ---- 文件树 ------------------------------------------------------------

function FilesRailButton() {
  return (
    <button
      className="rounded p-2 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
      title="文件系统"
    >
      ▤
    </button>
  );
}

function FileTree({ root }: { root: string }) {
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [expanded, setExpanded] = useState<Record<string, DirEntry[]>>({});

  useEffect(() => {
    void ipc.fsListDir(root).then(setEntries).catch(() => setEntries([]));
  }, [root]);

  const toggle = (entry: DirEntry) => {
    if (!entry.isDir) {
      openFile(entry.path);
      return;
    }
    if (expanded[entry.path]) {
      setExpanded(({ [entry.path]: _, ...rest }) => rest);
    } else {
      void ipc.fsListDir(entry.path).then((children) =>
        setExpanded((prev) => ({ ...prev, [entry.path]: children })),
      );
    }
  };

  const renderEntries = (list: DirEntry[], depth: number) =>
    list.map((e) => (
      <div key={e.path}>
        <button
          className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-xs hover:bg-neutral-800"
          style={{ paddingLeft: depth * 12 + 4 }}
          onClick={() => toggle(e)}
        >
          <span className="text-neutral-500">
            {e.isDir ? (expanded[e.path] ? "▾" : "▸") : "·"}
          </span>
          {e.name}
        </button>
        {expanded[e.path] && renderEntries(expanded[e.path], depth + 1)}
      </div>
    ));

  return <div className="p-1">{renderEntries(entries, 0)}</div>;
}

export const filesPlugin: Plugin = {
  id: "files",
  activate(ctx) {
    ctx.contribute("rightSidebar.tab", {
      order: 0,
      component: () => (
        <FileTree root="/Users/chenxiangning/code/AI/github/tmd-cli" />
      ),
    });
    ctx.contribute("rightRail", { order: 0, component: FilesRailButton });
    ctx.contribute("overlay", { order: 0, component: FilePreviewOverlay });
  },
};
