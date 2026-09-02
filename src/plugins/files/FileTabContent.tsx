/**
 * 文件内容 tab 渲染 —— md 走 markdown 渲染管线(照抄 codemoss 富路径),
 * 其余文本经 fileHighlighter 注册点高亮;未注册或失败时降级到 <pre> 直渲。
 */

import { Suspense, lazy, useEffect, useState } from "react";
import { ipc } from "@kernel/ipc";
import { useEditorTabs } from "@kernel/tabs";
import { getFileHighlighter } from "@kernel/fileHighlighter";

/* md 预览管线(react-markdown/katex/mermaid/viewerjs 体积大)按需拆包:
   仅当真正打开 md 文件时才加载该 chunk。 */
const FileMarkdownPreview = lazy(() =>
  import("./markdown/FileMarkdownPreview").then((m) => ({
    default: m.FileMarkdownPreview,
  })),
);

const MARKDOWN_FILE_RE = /\.(md|markdown|mdx)$/i;

interface FilePayload {
  path: string;
  content: string | null;
  error: string | null;
  loaded: boolean;
}

/* 文件内容缓存:字节预算 LRU —— 命中提新,总占用超 32MB 时淘汰最旧条目,
   防止长时间浏览大文件后内存无界增长。Map 迭代序 = 插入序,即新旧序。 */
const FILE_CACHE_BYTE_BUDGET = 32 * 1024 * 1024;
const fileCache = new Map<string, FilePayload>();
let fileCacheBytes = 0;

/** 条目字节估算(UTF-16: length × 2) —— 仅作预算记账,不追求精确。 */
function payloadBytes(p: FilePayload): number {
  return p.content ? p.content.length * 2 : 0;
}

function cacheGet(path: string): FilePayload | undefined {
  const hit = fileCache.get(path);
  if (hit) {
    /* LRU:命中即提新(delete + set 把条目移到最新位) */
    fileCache.delete(path);
    fileCache.set(path, hit);
  }
  return hit;
}

function cacheSet(path: string, payload: FilePayload): void {
  const prev = fileCache.get(path);
  if (prev) fileCacheBytes -= payloadBytes(prev);
  fileCache.delete(path);
  fileCache.set(path, payload);
  fileCacheBytes += payloadBytes(payload);
  /* 超预算淘汰最旧;刚写入的这条永远保留(单文件超预算也容忍) */
  let oldest = fileCache.keys().next();
  while (fileCacheBytes > FILE_CACHE_BYTE_BUDGET && !oldest.done && oldest.value !== path) {
    fileCacheBytes -= payloadBytes(fileCache.get(oldest.value)!);
    fileCache.delete(oldest.value);
    oldest = fileCache.keys().next();
  }
}

function loadFile(path: string): FilePayload {
  const cached = cacheGet(path);
  if (cached) return cached;
  const fresh: FilePayload = { path, content: null, error: null, loaded: false };
  cacheSet(path, fresh);
  ipc.fsReadFile(path).then(
    (content) => {
      /* 条目可能已被 LRU 淘汰:直接重插结果(幂等,不复活半状态) */
      cacheSet(path, { path, content, error: null, loaded: true });
    },
    (e) => {
      cacheSet(path, { path, content: null, error: String(e), loaded: true });
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
    if (cacheGet(path)?.loaded) return;
    const timer = window.setInterval(() => {
      /* 加载中条目被 LRU 淘汰时,ipc 回调会把完成态重插回缓存,轮询自然终止 */
      if (cacheGet(path)?.loaded) {
        setTick((n) => n + 1);
        window.clearInterval(timer);
      }
    }, 100);
    return () => window.clearInterval(timer);
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
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center text-xs text-(--tmd-fg-faint)">
              加载中…
            </div>
          }
        >
          <FileMarkdownPreview value={payload.content ?? ""} sourceFilePath={path} />
        </Suspense>
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
