/**
 * 文件详情中央渲染分派 —— 自 FileTabContent.tsx 迁出(FileTabBody 复杂度超标):
 * 编辑器 / md 预览 / 结构化预览三分支,纯展示无自持状态。
 * 三条重管线(CodeMirror 全家 / react-markdown+katex+mermaid+viewerjs / Prism)
 * 的按需拆包 lazy 定义随分支迁入:真正进对应形态才拉 chunk(拆包行为不变)。
 */
import { Suspense, lazy } from "react";
import { retryImport } from "@kernel/lazyImport";
import { t } from "@kernel/i18n";
import { findRemoteFileSourceForUri } from "@kernel/fileSources";
import { Spinner } from "@kernel/Spinner";
import type { EditorView } from "@codemirror/view";
import type { FileDocState } from "./editor/useFileDocument";

/* 编辑器(CodeMirror 全家 + 主题/语言包)按需拆包:真正进入编辑态才拉 chunk。 */
const FileCodeEditor = lazy(retryImport(() => import("@kernel/cmEditor/FileCodeEditor").then((m) => ({ default: m.FileCodeEditor }))));

/* md 预览管线(react-markdown/katex/mermaid/viewerjs 体积大)按需拆包:
   仅当真正打开 md 文件时才加载该 chunk。 */
const FileMarkdownPreview = lazy(retryImport(() =>
  import("./markdown/FileMarkdownPreview").then((m) => ({ default: m.FileMarkdownPreview })),
));

/* 结构化预览(连带 Prism 高亮)按需拆包:仅 sh/Dockerfile 拉取。 */
const FileStructuredPreview = lazy(retryImport(() =>
  import("./render/FileStructuredPreview").then((m) => ({ default: m.FileStructuredPreview })),
));

/** 加载占位(中央三分支与字节通道/文本管线共用)。 */
export function LOADING() {
  return (
    <div className="flex h-full items-center justify-center gap-1.5 text-xs text-(--tmd-fg-faint)">
      <Spinner />
      {t("加载中…")}
    </div>
  );
}

/** 中央分派:showEditor → 编辑器;md → 预览;其余 → 结构化预览(自带滚动容器)。 */
export function FileCenterView({
  path,
  content,
  reveal,
  showEditor,
  isMd,
  remote,
  dark,
  doc,
  onViewReady,
}: {
  path: string;
  content: string;
  reveal: { line: number; seq: number } | null;
  showEditor: boolean;
  isMd: boolean;
  remote: boolean;
  dark: boolean;
  doc: FileDocState;
  onViewReady: (view: EditorView | null) => void;
}) {
  return showEditor ? (
    <Suspense fallback={<LOADING />}>
      <FileCodeEditor
        path={path}
        value={doc.content}
        dark={dark}
        readOnly={remote && !findRemoteFileSourceForUri(path)?.writeText}
        onChange={doc.setDoc}
        onSave={doc.save}
        onViewReady={onViewReady}
        revealLine={reveal?.line ?? null}
        revealSeq={reveal?.seq ?? 0}
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
  );
}
