/**
 * files 插件：右栏文件树(可插拔视觉 provider) + 中央 tab 文件预览(可插拔高亮器)。
 *
 * 注册点:
 * - fileVisual:文件类型→颜色/图标(默认 provider 可替换)
 * - fileHighlighter:文件内容→HTML(默认 highlight.js,可替换)
 */

import { useEffect, useState } from "react";
import { ipc, type DirEntry } from "@kernel/ipc";
import type { Plugin } from "@kernel/plugin";
import { openTab } from "@kernel/tabs";
import { registerFileHighlighter } from "@kernel/fileHighlighter";
import { registerFileVisual, resolveFileVisual } from "@kernel/fileVisual";
import { FileTabContent } from "./FileTabContent";
import { highlightSync } from "./highlighter";
import { defaultFileVisualProvider } from "./fileVisual";

function openFileInTab(path: string) {
  openTab({
    id: `file:${path}`,
    title: path.split("/").pop() ?? path,
    path,
    kind: "file",
    payload: { path },
  });
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
    list.map((e) => {
      const hint = resolveFileVisual(e.name, e.isDir);
      const color = hint.colorClass ?? "text-neutral-300";
      const glyph = hint.glyph ?? "·";
      const isOpen = expanded[e.path] !== undefined;
      return (
        <div key={e.path}>
          <button
            className={`flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-xs hover:bg-neutral-800 ${color}`}
            style={{ paddingLeft: depth * 12 + 4 }}
            onClick={() => toggle(e)}
          >
            <span className="w-4 shrink-0 text-center">
              {e.isDir ? (isOpen ? "▾" : "▸") : glyph}
            </span>
            <span className="truncate">{e.name}</span>
          </button>
          {isOpen && renderEntries(expanded[e.path], depth + 1)}
        </div>
      );
    });

  return <div className="p-1">{renderEntries(entries, 0)}</div>;
}

export const filesPlugin: Plugin = {
  id: "files",
  activate(ctx) {
    // 注册默认视觉 provider + 高亮器(其它插件可注册 order 更小的覆盖)
    registerFileVisual(defaultFileVisualProvider);
    registerFileHighlighter({
      supports: (path) => highlightSync(path, "") !== null,
      highlight: async (path, content) => highlightSync(path, content),
    });

    ctx.contribute("rightSidebar.tab", {
      order: 0,
      component: () => (
        <FileTree root="/Users/chenxiangning/code/AI/github/tmd-cli" />
      ),
    });
    ctx.contribute("editorCenter.tabContent", {
      order: 0,
      component: FileTabContent,
    });
  },
};
