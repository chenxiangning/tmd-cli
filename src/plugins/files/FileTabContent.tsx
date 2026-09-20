/**
 * 文件内容 tab 渲染 —— v3:按渲染档案(renderProfile)分发。
 *
 * - md:markdown 预览管线 + 编辑切换(v2 行为,不动);
 * - sh/Dockerfile:结构化预览 + 编辑切换(同 md 的切换交互);
 * - 图片/PDF/表格(csv/xls/xlsx)/文档(doc/docx)/二进制:render/* 专用面;
 * - 其余文本:CodeMirror 编辑(可写、⌘S 保存、草稿保留)。
 * 重库(pdf.js/xlsx/mammoth/结构化预览的 Prism)一律 lazy 拆包,打开对应类型才拉 chunk。
 */

import { Suspense, lazy, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ModeToggleButton, useDarkTheme } from "./editor/editorChrome";
import { statusText, toolbarCls } from "./editor/editorChromeLogic";
import type { EditorTab } from "@kernel/tabs";
import { t } from "@kernel/i18n";
import {
  getFileCacheVersion,
  loadFile,
  subscribeFileCache,
} from "./editor/fileCache";
import { takeFileRevealLine } from "@kernel/fileTabs";

/* 编辑器(CodeMirror 全家 + 主题/语言包)按需拆包:真正进入编辑态才拉 chunk。
   useFileDocument 只依赖轻量 fileCache,静态引入不拖累拆包。 */
const FileCodeEditor = lazy(() => import("@kernel/cmEditor/FileCodeEditor").then((m) => ({ default: m.FileCodeEditor })));
import { useFileDocument } from "./editor/useFileDocument";

/* md 预览管线(react-markdown/katex/mermaid/viewerjs 体积大)按需拆包:
   仅当真正打开 md 文件时才加载该 chunk。 */
const FileMarkdownPreview = lazy(() =>
  import("./markdown/FileMarkdownPreview").then((m) => ({ default: m.FileMarkdownPreview })),
);

/* 结构化预览(连带 Prism 高亮)按需拆包:仅 sh/Dockerfile 拉取。 */
const FileStructuredPreview = lazy(() =>
  import("./render/FileStructuredPreview").then((m) => ({ default: m.FileStructuredPreview })),
);
/* pdf.js / xlsx / mammoth 三条重库管线:各自类型才拉 chunk。 */
const FilePdfPreview = lazy(() =>
  import("./render/FilePdfPreview").then((m) => ({ default: m.FilePdfPreview })),
);
const FileTabularPreview = lazy(() => import("./render/FileTabularPreview").then((m) => ({ default: m.FileTabularPreview })));
const FileDocumentPreview = lazy(() => import("./render/FileDocumentPreview").then((m) => ({ default: m.FileDocumentPreview })));

import { FileImagePreview } from "./render/FileImagePreview";
import { FileBinaryUnsupported } from "./render/FileBinaryUnsupported";
import {
  isTabularBinaryPath,
  resolveFileRenderProfile,
  resolveStructuredPreviewKind,
  type FileRenderKind,
} from "./render/renderProfile";
import { isRemoteFileUri } from "@kernel/fileSources";
import { OpenWithMenu } from "./OpenWithMenu";
import { useFileBlame } from "./useFileBlame";
import { fileDetailActions } from "./fileDetailActions";
import type { EditorView } from "@codemirror/view";
import { useFileDetailMenu } from "./useFileDetailMenu";

const MARKDOWN_FILE_RE = /\.(md|markdown|mdx)$/i;

/** md / 结构化文件的「编辑 vs 预览」偏好(按路径,进程内记住,切 tab 不丢)。 */
const mdEditMode = new Map<string, boolean>();
const structuredEditMode = new Map<string, boolean>();

/** 单文件主体:key={path} —— 文档状态、md/结构化切换偏好随文件切换整体重建。
 *  wslr:// 远程文件:同一渲染规则,编辑器只读(M1 不做远程写回)。 */
function FileTabBody({
  path,
  content,
  reveal,
}: {
  path: string;
  content: string;
  reveal: { line: number; seq: number } | null;
}) {
  const isMd = MARKDOWN_FILE_RE.test(path);
  const remote = isRemoteFileUri(path);
  const structuredKind = isMd ? null : resolveStructuredPreviewKind(path);
  const [mdEditor, setMdEditor] = useState(() => mdEditMode.get(path) ?? false);
  const [structuredEditor, setStructuredEditor] = useState(
    () => structuredEditMode.get(path) ?? false,
  );
  const dark = useDarkTheme();  /* 文档钩子常驻(含 md 预览态):⌘S 预览下也能保存,状态文字两模式连续显示。 */
  const doc = useFileDocument(path, content);
  const status = statusText(doc, remote);

  const showEditor = !structuredKind ? (!isMd || mdEditor) : structuredEditor;
  /* 详情页右键菜单(JetBrains 同型最小集):viewRef 持编辑器实例,剪切/粘贴直驱事务。 */
  const viewRef = useRef<EditorView | null>(null);
  const editorActive = showEditor && !remote;
  /* 命令桥:内核快捷键(⌥F1 定位 / ⌥⇧H 历史 / ⌥⇧B blame)读当前详情上下文。 */
  useEffect(() => {
    fileDetailActions.current = { path, remote };
    return () => {
      fileDetailActions.current = null;
    };
  }, [path, remote]);
  const { blameOn, toggleBlame } = useFileBlame({ path, active: editorActive, viewRef });
  const { detailMenuProps, detailMenu } = useFileDetailMenu({
    variant: showEditor ? "editor" : "preview",
    path,
    viewRef,
    remote,
    dirty: doc.dirty,
    canToggle: Boolean(structuredKind) || isMd,
    editorOpen: showEditor,
    canBlame: editorActive,
    blameActive: blameOn,
    onToggleBlame: toggleBlame,
    onToggle: () => {
      const next = !showEditor;
      if (structuredKind) {
        structuredEditMode.set(path, next);
        setStructuredEditor(next);
      } else {
        mdEditMode.set(path, next);
        setMdEditor(next);
      }
    },
    onSave: doc.save,
  });
  return (
    <div className="file-editor-shell">
      <div className="file-editor-body" {...detailMenuProps}>
        {showEditor ? (
          <Suspense fallback={<LOADING />}>
            <FileCodeEditor
              path={path}
              value={doc.content}
              dark={dark}
              readOnly={remote}
              onChange={doc.setDoc}
              onSave={doc.save}
              onViewReady={(view) => { viewRef.current = view; }}
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
        )}
      </div>
      {/* 矮工具条:状态文字在左;右侧 = 编辑/预览切换钮(md 与结构化才有)+ 打开方式入口(远程文件不出) */}
      <div
        className={toolbarCls(doc.error, doc.dirty)}
        role="status"
      >
        <span className="file-editor-toolbar-status">{status}</span>
        <span className="file-editor-toolbar-right">
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
          {!remote && <OpenWithMenu path={path} />}
        </span>
      </div>
      {detailMenu}
    </div>
  );
}

const LOADING = () => (
  <div className="flex h-full items-center justify-center text-xs text-(--tmd-fg-faint)">
    {t("加载中…")}
  </div>
);

/** 字节通道型渲染形态(不走 fileCache 文本管线的分支集合)。 */
function isByteChannelKind(path: string, kind: FileRenderKind): boolean {
  return (
    kind === "image" ||
    kind === "pdf" ||
    kind === "document" ||
    kind === "binary-unsupported" ||
    (kind === "tabular" && isTabularBinaryPath(path))
  );
}

/** 字节通道渲染分派(图片/二进制占位自取数据;PDF/文档/二进制表格走字节管线)。 */
function ByteChannelView({ path, kind }: { path: string; kind: FileRenderKind }) {
  /* 字节态菜单仅 路径/访达 两项;display:contents 包装零布局影响。 */
  const viewRef = useRef<EditorView | null>(null);
  const { detailMenuProps, detailMenu } = useFileDetailMenu({ variant: "byte", path, viewRef });
  return (
    <>
      <div className="contents" {...detailMenuProps}>
        {kind === "image" ? <FileImagePreview path={path} /> : null}
        {kind === "binary-unsupported" ? <FileBinaryUnsupported path={path} /> : null}
        {kind === "pdf" ? (
          <Suspense fallback={<LOADING />}>
            <FilePdfPreview path={path} />
          </Suspense>
        ) : null}
        {kind === "document" ? (
          <Suspense fallback={<LOADING />}>
            <FileDocumentPreview path={path} />
          </Suspense>
        ) : null}
        {kind === "tabular" ? (
          <Suspense fallback={<LOADING />}>
            <FileTabularPreview path={path} text={null} />
          </Suspense>
        ) : null}
      </div>
      {detailMenu}
    </>
  );
}

/** 文本管线视图(csv 表格/markdown/结构化/代码,走 fileCache)。 */
function TextFileView({
  path,
  kind,
  reveal,
}: {
  path: string;
  kind: FileRenderKind;
  reveal: { line: number; seq: number } | null;
}) {
  const payload = loadFile(path);
  if (payload.error) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-red-400">
        ⚠ {payload.error}
      </div>
    );
  }
  if (!payload.loaded) return <LOADING />;
  if (kind === "tabular") {
    return (
      <Suspense fallback={<LOADING />}>
        <FileTabularPreview path={path} text={payload.content ?? ""} />
      </Suspense>
    );
  }
  return (
    <FileTabBody key={path} path={path} content={payload.content ?? ""} reveal={reveal} />
  );
}

export function FileTabContent({ tab }: { tab: EditorTab }) {
  /* 缓存任意变更(加载完成/刷新重读/保存回写)都推版本号 → 重渲拿到最新内容。 */
  useSyncExternalStore(subscribeFileCache, getFileCacheVersion);
  /* kind="file" 的 tab:path 为绝对路径(payload 同源,直接取 path 字段)。 */
  const path = tab.path;
  /* 搜索命中定位行:openFileAtLine 每次都以 refresh 换新 payload 对象 → 本 effect
     随重渲再跑;take 一次性消费,ref 保值防 StrictMode 双跑把已取走的行清空。 */
  /* line+seq 二元组:同文件同行号的二次命中也要重新定位(React 对同值
     bail-out,seq 打破;P3 评审项)。 */
  const [reveal, setReveal] = useState<{ line: number; seq: number } | null>(null);
  const revealRef = useRef<{ line: number; seq: number } | null>(null);
  const revealSeqRef = useRef(0);
  useEffect(() => {
    const line = takeFileRevealLine(path);
    if (line !== null) revealRef.current = { line, seq: ++revealSeqRef.current };
    setReveal(revealRef.current);
  }, [path, tab.payload]);
  const profile = resolveFileRenderProfile(path);

  /* 远程 M1:字节通道型渲染(图片/PDF/文档/二进制表格)读不了 —— 显式占位,
     不喂本地 fs 通道吃 wslr:// 路径(必报错)。文本族(md/code/structured/csv)照常。 */
  if (isRemoteFileUri(path) && isByteChannelKind(path, profile.kind)) {
    return (
      <div className="filetree-wsl-degraded">
        <b>{t("远程文件")}</b>
        <span>{t("该类型暂不支持远程预览(M1):请经终端会话操作。")}</span>
      </div>
    );
  }
  if (isByteChannelKind(path, profile.kind)) {
    return <ByteChannelView path={path} kind={profile.kind} />;
  }
  return <TextFileView path={path} kind={profile.kind} reveal={reveal} />;
}
