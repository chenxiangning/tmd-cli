/**
 * 文件内容 tab 渲染 —— v3:按渲染档案(renderProfile)分发。
 *
 * - md:markdown 预览管线 + 编辑切换(v2 行为,不动);
 * - sh/Dockerfile:结构化预览 + 编辑切换(同 md 的切换交互);
 * - 图片/PDF/表格(csv/xls/xlsx)/文档(doc/docx)/二进制:render/* 专用面;
 * - 其余文本:CodeMirror 编辑(可写、⌘S 保存、草稿保留)。
 * 重库(pdf.js/xlsx/mammoth/结构化预览的 Prism)一律 lazy 拆包,打开对应类型才拉 chunk。
 */

import { Suspense, lazy, useEffect, useState, useSyncExternalStore } from "react";
import { Eye, Pencil } from "@phosphor-icons/react";
import type { EditorTab } from "@kernel/tabs";
import { t } from "@kernel/i18n";
import {
  getFileCacheVersion,
  loadFile,
  subscribeFileCache,
} from "./editor/fileCache";

/* 编辑器(CodeMirror 全家 + 主题/语言包)按需拆包:真正进入编辑态才拉 chunk。
   useFileDocument 只依赖轻量 fileCache,静态引入不拖累拆包。 */
const FileCodeEditor = lazy(() =>
  import("@kernel/cmEditor/FileCodeEditor").then((m) => ({ default: m.FileCodeEditor })),
);
import { useFileDocument } from "./editor/useFileDocument";

/* md 预览管线(react-markdown/katex/mermaid/viewerjs 体积大)按需拆包:
   仅当真正打开 md 文件时才加载该 chunk。 */
const FileMarkdownPreview = lazy(() =>
  import("./markdown/FileMarkdownPreview").then((m) => ({
    default: m.FileMarkdownPreview,
  })),
);

/* 结构化预览(连带 Prism 高亮)按需拆包:仅 sh/Dockerfile 拉取。 */
const FileStructuredPreview = lazy(() =>
  import("./render/FileStructuredPreview").then((m) => ({
    default: m.FileStructuredPreview,
  })),
);
/* pdf.js / xlsx / mammoth 三条重库管线:各自类型才拉 chunk。 */
const FilePdfPreview = lazy(() =>
  import("./render/FilePdfPreview").then((m) => ({ default: m.FilePdfPreview })),
);
const FileTabularPreview = lazy(() =>
  import("./render/FileTabularPreview").then((m) => ({
    default: m.FileTabularPreview,
  })),
);
const FileDocumentPreview = lazy(() =>
  import("./render/FileDocumentPreview").then((m) => ({
    default: m.FileDocumentPreview,
  })),
);

import { FileImagePreview } from "./render/FileImagePreview";
import { FileBinaryUnsupported } from "./render/FileBinaryUnsupported";
import {
  isTabularBinaryPath,
  resolveFileRenderProfile,
  resolveStructuredPreviewKind,
} from "./render/renderProfile";

const MARKDOWN_FILE_RE = /\.(md|markdown|mdx)$/i;

/** md / 结构化文件的「编辑 vs 预览」偏好(按路径,进程内记住,切 tab 不丢)。 */
const mdEditMode = new Map<string, boolean>();
const structuredEditMode = new Map<string, boolean>();

/** 编辑器明暗跟随 <html data-theme>(custom preset 也只二分 dark/light)。 */
function useDarkTheme(): boolean {
  const [dark, setDark] = useState(() =>
    typeof document === "undefined"
      ? false
      : document.documentElement.getAttribute("data-theme") === "dark",
  );
  useEffect(() => {
    if (typeof document === "undefined") return;
    const observer = new MutationObserver(() => {
      setDark(document.documentElement.getAttribute("data-theme") === "dark");
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);
  return dark;
}

/** 工具条状态文案:错误 > 保存中 > 脏 > 已保存。 */
function statusText(doc: { error: string | null; saving: boolean; dirty: boolean }): string {
  if (doc.error) return doc.error;
  if (doc.saving) return t("保存中…");
  if (doc.dirty) return t("● 未保存的更改 · ⌘S 保存");
  return t("已保存");
}

/** 工具条错误/脏标记着色。 */
function toolbarCls(error: string | null, dirty: boolean): string {
  return `file-editor-toolbar${error ? " is-error" : dirty ? " is-dirty" : ""}`;
}

/** 编辑/预览切换钮(单钮两态,md 与结构化文件共用;偏好随路径持久由调用方落)。 */
function ModeToggleButton({
  editor,
  onToggle,
}: {
  editor: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      className="file-mode-toggle"
      title={editor ? t("预览") : t("编辑")}
      onClick={() => onToggle(!editor)}
    >
      {editor ? <Eye size="0.75rem" aria-hidden /> : <Pencil size="0.75rem" aria-hidden />}
      {editor ? t("预览") : t("编辑")}
    </button>
  );
}


/** 单文件主体:key={path} —— 文档状态、md/结构化切换偏好随文件切换整体重建。 */
function FileTabBody({ path, content }: { path: string; content: string }) {
  const isMd = MARKDOWN_FILE_RE.test(path);
  const structuredKind = isMd ? null : resolveStructuredPreviewKind(path);
  const [mdEditor, setMdEditor] = useState(() => mdEditMode.get(path) ?? false);
  const [structuredEditor, setStructuredEditor] = useState(
    () => structuredEditMode.get(path) ?? false,
  );
  const dark = useDarkTheme();
  /* 文档钩子常驻(含 md 预览态):⌘S 在预览下也能保存未落盘草稿,
     状态文字两种模式连续显示。 */
  const doc = useFileDocument(path, content);
  const status = statusText(doc);

  const showEditor = !structuredKind ? (!isMd || mdEditor) : structuredEditor;
  return (
    <div className="file-editor-shell">
      <div className="file-editor-body">
        {showEditor ? (
          <Suspense fallback={<LOADING />}>
            <FileCodeEditor
              path={path}
              value={doc.content}
              dark={dark}
              onChange={doc.setDoc}
              onSave={doc.save}
            />
          </Suspense>
        ) : isMd ? (
          /* md 预览自带滚动容器(fvp-markdown-preview-frame/scroll,章节浮窗锚点依赖它) */
          <Suspense fallback={<LOADING />}>
            <FileMarkdownPreview value={content} sourceFilePath={path} />
          </Suspense>
        ) : (
          <div className="fvp-preview-scroll">
            <Suspense fallback={<LOADING />}>
              <FileStructuredPreview filePath={path} value={content} />
            </Suspense>
          </div>
        )}
      </div>
      {/* 矮工具条:状态文字在左,编辑/预览切换钮在右(md 与结构化文件才有) */}
      <div
        className={toolbarCls(doc.error, doc.dirty)}
        role="status"
      >
        <span className="file-editor-toolbar-status">{status}</span>
        {structuredKind ? (
          <ModeToggleButton
            editor={structuredEditor}
            onToggle={(next) => {
              structuredEditMode.set(path, next);
              setStructuredEditor(next);
            }}
          />
        ) : isMd ? (
          <ModeToggleButton
            editor={mdEditor}
            onToggle={(next) => {
              mdEditMode.set(path, next);
              setMdEditor(next);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

const LOADING = () => (
  <div className="flex h-full items-center justify-center text-xs text-(--tmd-fg-faint)">
    {t("加载中…")}
  </div>
);

export function FileTabContent({ tab }: { tab: EditorTab }) {
  /* 缓存任意变更(加载完成/刷新重读/保存回写)都推版本号 → 重渲拿到最新内容。 */
  useSyncExternalStore(subscribeFileCache, getFileCacheVersion);
  /* kind="file" 的 tab:path 为绝对路径(payload 同源,直接取 path 字段)。 */
  const path = tab.path;

  /* ── 不走文本缓存的面:图片/二进制占位自取数据,PDF/文档/二进制表格走字节通道 ── */
  const profile = resolveFileRenderProfile(path);
  if (profile.kind === "image") {
    return <FileImagePreview path={path} />;
  }
  if (profile.kind === "binary-unsupported") {
    return <FileBinaryUnsupported path={path} />;
  }
  if (profile.kind === "pdf") {
    return (
      <Suspense fallback={<LOADING />}>
        <FilePdfPreview path={path} />
      </Suspense>
    );
  }
  if (profile.kind === "document") {
    return (
      <Suspense fallback={<LOADING />}>
        <FileDocumentPreview path={path} />
      </Suspense>
    );
  }
  if (profile.kind === "tabular" && isTabularBinaryPath(path)) {
    return (
      <Suspense fallback={<LOADING />}>
        <FileTabularPreview path={path} text={null} />
      </Suspense>
    );
  }

  /* ── 其余形态(csv 表格/markdown/结构化/代码)需要文本内容:走 fileCache ── */
  const payload = loadFile(path);
  if (payload.error) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-red-400">
        ⚠ {payload.error}
      </div>
    );
  }
  if (!payload.loaded) return <LOADING />;

  if (profile.kind === "tabular") {
    return (
      <Suspense fallback={<LOADING />}>
        <FileTabularPreview path={path} text={payload.content ?? ""} />
      </Suspense>
    );
  }

  return <FileTabBody key={path} path={path} content={payload.content ?? ""} />;
}
