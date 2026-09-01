/**
 * 文件内容 tab 渲染 —— md 走 markdown 渲染管线(照抄 codemoss 富路径),
 * 其余文本经 fileHighlighter 注册点高亮;未注册或失败时降级到 <pre> 直渲。
 */

import { useEffect, useState } from "react";
import { ipc } from "@kernel/ipc";
import { useEditorTabs } from "@kernel/tabs";
import { getFileHighlighter } from "@kernel/fileHighlighter";
import { FileMarkdownPreview } from "./markdown/FileMarkdownPreview";

const MARKDOWN_FILE_RE = /\.(md|markdown|mdx)$/i;

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

export function FileTabContent() {
  const { activeId, tabs } = useEditorTabs();
  const active = tabs.find((t) => t.id === activeId);
  const [, setTick] = useState(0);
  const [highlighted, setHighlighted] = useState<string | null>(null);

  const path = active?.kind === "file" ? active.path : null;
  const payload = path ? loadFile(path) : null;

  // 等待 cache 变 loaded 后强制重渲
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

  // 高亮(经注册点,可插拔)
  useEffect(() => {
    if (!payload?.loaded || !payload.content || !path) {
      setHighlighted(null);
      return;
    }
    const highlighter = getFileHighlighter();
    if (!highlighter || !highlighter.supports(path)) {
      setHighlighted(null);
      return;
    }
    let cancelled = false;
    void highlighter.highlight(path, payload.content).then((html) => {
      if (!cancelled) setHighlighted(html);
    });
    return () => {
      cancelled = true;
    };
  }, [payload?.loaded, payload?.content, path]);

  if (!active || active.kind !== "file" || !payload) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-(--tmd-fg-faint)">
        选中一个文件查看
      </div>
    );
  }

  if (payload.error) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-red-400">
        ⚠ {payload.error}
      </div>
    );
  }

  if (!payload.loaded) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-(--tmd-fg-faint)">
        加载中…
      </div>
    );
  }

  if (path && MARKDOWN_FILE_RE.test(path)) {
    /* md 预览自带滚动容器(fvp-markdown-preview-frame/scroll,章节浮窗锚点依赖它),
       外层不再包 overflow-auto,避免双滚动条。 */
    return (
      <div className="flex h-full flex-col">
        <FileMarkdownPreview value={payload.content ?? ""} sourceFilePath={path} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        {highlighted ? (
          <div
            className="hljs-preview p-3 text-xs leading-[1.58]"
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
        ) : (
          <pre className="p-3 text-xs leading-[1.58] text-(--tmd-fg)">
            {payload.content}
          </pre>
        )}
      </div>
    </div>
  );
}
