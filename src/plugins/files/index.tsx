/**
 * files 插件：右栏文件树 + 中央 tab 文件预览。
 *
 * 设计：
 * - 文件点击 → 调 openTab() 走 kernel 全局 tabs store
 * - 中央 tab 渲染由 files 自己提供 tabContent 组件，读 active tab 的 payload
 * - overlay 不再挂；保留兜底组件但不在插件里激活
 */

import { useEffect, useState } from "react";
import { ipc, type DirEntry } from "@kernel/ipc";
import type { Plugin } from "@kernel/plugin";
import { openTab, useEditorTabs } from "@kernel/tabs";

// ---- 文件 tab 内容载体 --------------------------------------------------

interface FilePayload {
  path: string;
  content: string | null;
  error: string | null;
  loaded: boolean;
}

const fileCache = new Map<string, FilePayload>();

function loadFile(path: string): FilePayload {
  const cached = fileCache.get(path);
  if (cached) return cached;
  const fresh: FilePayload = { path, content: null, error: null, loaded: false };
  fileCache.set(path, fresh);
  ipc.fsReadFile(path).then(
    (content) => {
      const cur = fileCache.get(path);
      if (cur) fileCache.set(path, { ...cur, content, loaded: true });
    },
    (e) => {
      const cur = fileCache.get(path);
      if (cur) fileCache.set(path, { ...cur, error: String(e), loaded: true });
    },
  );
  return fresh;
}

function openFileInTab(path: string) {
  openTab({
    id: `file:${path}`,
    title: path.split("/").pop() ?? path,
    path,
    kind: "file",
    payload: { path },
  });
}

function FileTabContent() {
  const { activeId, tabs } = useEditorTabs();
  const active = tabs.find((t) => t.id === activeId);
  const [, setTick] = useState(0);

  // 读 fileCache 拿活跃 payload;点开异步结果会更新 cache,触发 setTick 重渲。
  const path = active?.kind === "file" ? active.path : null;
  const payload = path ? loadFile(path) : null;

  useEffect(() => {
    if (!path) return;
    if (fileCache.get(path)?.loaded) return;
    const timer = setInterval(() => {
      if (fileCache.get(path)?.loaded) {
        setTick((n) => n + 1);
        clearInterval(timer);
      }
    }, 100);
    return () => clearInterval(timer);
  }, [path]);

  if (!active || active.kind !== "file" || !payload) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-neutral-600">
        选中一个文件查看
      </div>
    );
  }

  return (
    <pre className="h-full w-full overflow-auto p-3 text-xs leading-5 text-neutral-300">
      {payload.error ? `⚠ ${payload.error}` : payload.loaded ? payload.content : "加载中…"}
    </pre>
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
      openFileInTab(entry.path);
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
    ctx.contribute("editorCenter.tabContent", {
      order: 0,
      component: FileTabContent,
    });
  },
};
