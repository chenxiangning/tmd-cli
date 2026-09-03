/**
 * 文件内容 tab 渲染 —— v2:文本文件直接进 CodeMirror 编辑(可写、⌘S 保存、
 * 草稿保留),md 默认走 markdown 渲染管线 + 右上角「编辑/预览」切换,
 * 其余形态(二进制/超大/读取失败)维持只读占位。
 *
 * 旧的高亮只读预览被编辑器取代,fileHighlighter 注册点与 highlight.js 依赖已移除。
 */

import { Suspense, lazy, useEffect, useState } from "react";
import { Eye, Pencil } from "lucide-react";
import { useEditorTabs } from "@kernel/tabs";
import { cacheGet, loadFile } from "./editor/fileCache";

/* 编辑器(CodeMirror 全家 + 主题/语言包)按需拆包:真正进入编辑态才拉 chunk。
   useFileDocument 只依赖轻量 fileCache,静态引入不拖累拆包。 */
const FileCodeEditor = lazy(() =>
  import("./editor/FileCodeEditor").then((m) => ({ default: m.FileCodeEditor })),
);
import { useFileDocument } from "./editor/useFileDocument";

/* md 预览管线(react-markdown/katex/mermaid/viewerjs 体积大)按需拆包:
   仅当真正打开 md 文件时才加载该 chunk。 */
const FileMarkdownPreview = lazy(() =>
  import("./markdown/FileMarkdownPreview").then((m) => ({
    default: m.FileMarkdownPreview,
  })),
);

const MARKDOWN_FILE_RE = /\.(md|markdown|mdx)$/i;

/** md 编辑/预览偏好(按路径,进程内记住,切 tab 不丢)。 */
const mdEditMode = new Map<string, boolean>();

/** 编辑器明暗跟随 <html data-theme>(custom preset 也只二分 dark/light)。 */
function useDarkTheme(): boolean {
  const [dark, setDark] = useState(
    () => document.documentElement.dataset.theme === "dark",
  );
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      setDark(root.dataset.theme === "dark");
    });
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

/** 单文件主体:key={path} —— 文档状态、md 切换偏好随文件切换整体重建。 */
function FileTabBody({ path, content }: { path: string; content: string }) {
  const isMd = MARKDOWN_FILE_RE.test(path);
  const [mdEditor, setMdEditor] = useState(() => mdEditMode.get(path) ?? false);
  const dark = useDarkTheme();
  /* 文档钩子常驻(含 md 预览态):⌘S 在预览下也能保存未落盘草稿,
     状态文字两种模式连续显示。 */
  const doc = useFileDocument(path, content);
  const status =
    doc.error ?? (doc.saving ? "保存中…" : doc.dirty ? "● 未保存的更改 · ⌘S 保存" : "已保存");

  const showEditor = !isMd || mdEditor;
  return (
    <div className="file-editor-shell">
      <div className="file-editor-body">
        {showEditor ? (
          <Suspense fallback={LOADING}>
            <FileCodeEditor
              path={path}
              value={doc.content}
              dark={dark}
              onChange={doc.setDoc}
              onSave={doc.save}
            />
          </Suspense>
        ) : (
          /* md 预览自带滚动容器(fvp-markdown-preview-frame/scroll,章节浮窗锚点依赖它) */
          <Suspense fallback={LOADING}>
            <FileMarkdownPreview value={content} sourceFilePath={path} />
          </Suspense>
        )}
      </div>
      {/* 矮工具条:状态文字在左,编辑/预览切换钮在右(md 才有) */}
      <div
        className={`file-editor-toolbar${doc.error ? " is-error" : doc.dirty ? " is-dirty" : ""}`}
        role="status"
      >
        <span className="file-editor-toolbar-status">{status}</span>
        {isMd ? (
          <button
            type="button"
            className="file-mode-toggle"
            title={mdEditor ? "预览" : "编辑"}
            onClick={() => {
              const next = !mdEditor;
              mdEditMode.set(path, next);
              setMdEditor(next);
            }}
          >
            {mdEditor ? <Eye size={12} aria-hidden /> : <Pencil size={12} aria-hidden />}
            {mdEditor ? "预览" : "编辑"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

const LOADING = (
  <div className="flex h-full items-center justify-center text-xs text-(--tmd-fg-faint)">
    加载中…
  </div>
);

export function FileTabContent() {
  const { activeId, tabs } = useEditorTabs();
  const active = tabs.find((t) => t.id === activeId);
  const [, setTick] = useState(0);

  const isFileTab = active?.kind === "file";
  const path = isFileTab ? active.path : null;
  const payload = path ? loadFile(path) : null;

  /* hooks 必须无条件执行:本组件对不同 kind 的 tab 都会挂载,
     早退分支只能放在全部 hooks 之后(否则切 tab 时 hooks 数量错配)。 */
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

  /* 多 kind 并存:非 file kind 的 tab(如 checkpoints 批审阅单)由各自插件的
     挂载组件渲染,这里让位返回 null;无任何 tab 时本组件仍兜底空态 */
  if (!active) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-(--tmd-fg-faint)">
        选中一个文件查看
      </div>
    );
  }
  if (!isFileTab || !path || !payload) {
    if (!isFileTab) return null;
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

  if (!payload.loaded) return LOADING;

  return <FileTabBody key={path} path={path} content={payload.content ?? ""} />;
}
