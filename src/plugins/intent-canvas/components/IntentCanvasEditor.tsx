/**
 * 意图画布 · 编辑器(移植自 mossx IntentCanvasEditor,左右栏与草稿逻辑拆出)。
 * 中央 = lazy Excalidraw(网格+吸附,关闭 load/save/export 入口);顶栏 =
 * 返回/保存态/保存/关联当前会话;底部状态栏 id/mode/更新时间。
 */

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChatText, CircleNotch, FloppyDisk } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { cn } from "../utils/cn";
import type { ExcalidrawInitialDataState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { buildTraceabilityProjection } from "../utils/traceability";
import {
  excalidrawLangCode,
  formatDateTime,
  useCanvasTheme,
  type IntentCanvasEditorProps,
} from "./EditorShared";
import { useEditorDraft } from "./useEditorDraft";
import { EditorLeftRail } from "./EditorLeftRail";
import { EditorRightRail } from "./EditorRightRail";
import { ConfirmBubble } from "./ConfirmBubble";

/* 动态 import 是刻意的代码分割:excalidraw 体积 MB 级,静态引入会打进主 chunk,
   破坏 tmd-cli 首屏零加载预算(mossx 同款 lazy 模式);非运行时选路。
   样式表必须与 JS 同 chunk 引入:漏掉 = 图标失去尺寸约束渲染成巨 SVG(0.2.5 验收实测)。 */
const LazyExcalidraw = lazy(async () => {
  const module = await import("@excalidraw/excalidraw");
  /* 样式表必须与 JS 同 chunk 引入:漏掉 = 图标失去尺寸约束渲染成巨 SVG(0.2.5 验收实测)。 */
  await import("@excalidraw/excalidraw/index.css");
  return { default: module.Excalidraw };
});

export { normalizeError } from "./EditorShared";
export type { IntentCanvasOpenSourceFile } from "./EditorShared";

export function IntentCanvasEditor({
  document,
  activeThreadId,
  isSaving,
  onBack,
  onSave,
  onAttachToThread,
  onOpenProjectMap,
  onOpenSourceFile,
  managerErrorMessage = null,
}: IntentCanvasEditorProps) {
  const excalidrawTheme = useCanvasTheme();
  /* 默认折叠:画布最大化(0.2.5 验收反馈);展开态由用户手动保持。 */
  const [leftRailCollapsed, setLeftRailCollapsed] = useState(true);
  const [rightRailCollapsed, setRightRailCollapsed] = useState(true);
  const [isBackConfirmOpen, setBackConfirmOpen] = useState(false);
  const excalidrawApiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  /* 必须稳定引用:内联箭头每渲染新函数,Excalidraw 内部 effect 连锁 setState
     → Maximum update depth,画布整树被 PluginBoundary 重建成白屏。 */
  const handleExcalidrawApi = useCallback((api: ExcalidrawImperativeAPI) => {
    excalidrawApiRef.current = api;
  }, []);
  /* 折叠切换是 grid 列宽的外部尺寸变化:官方要求此时手动 refresh 重算画布
     视口,否则指针坐标按过期 rect 换算,点击选择错位。 */
  useEffect(() => {
    excalidrawApiRef.current?.refresh();
  }, [leftRailCollapsed, rightRailCollapsed]);

  const draft = useEditorDraft({ document, activeThreadId, onSave, onAttachToThread });
  const {
    title,
    summary,
    fileLinksText,
    nodeLinksText,
    threadLinksText,
    isDirty,
    saveError,
    elementCount,
    handleSceneChange,
    handleSave,
    handleAttachToThread,
    metadataChange,
    transmissionContextJson,
  } = draft;

  const initialData = useMemo<ExcalidrawInitialDataState>(
    () => ({
      elements: document.scene.elements,
      appState: document.scene.appState,
      files: document.scene.files,
    }),
    [document.scene.appState, document.scene.elements, document.scene.files],
  );

  const langCode = excalidrawLangCode();
  const hasProjectMapImportSource =
    document.links.projectMapNodeIds.length > 0 ||
    document.semanticGraphs.some((graph) => graph.sourceSnapshot?.kind === "project-map-relations");

  // tmd-cli 无 project-map 扫描器:导入源运行态恒 null(不判定 stale/unresolved,
  // 来源追溯仅呈现 path 级回链)。AI 产出的 semanticGraphs 数据面与 UI 管线保留。
  const runtimeRelationshipSourceState = null;
  const traceabilityProjection = useMemo(
    () => buildTraceabilityProjection(document.semanticGraphs, runtimeRelationshipSourceState),
    [document.semanticGraphs, runtimeRelationshipSourceState],
  );

  const handleOpenBacklink = useCallback(
    (backlink: { path: string | null; unresolved?: boolean; location?: { line: number; column: number } | null }) => {
      if (!onOpenSourceFile || !backlink.path || backlink.unresolved) {
        return;
      }
      onOpenSourceFile(backlink.path, backlink.location ?? undefined);
    },
    [onOpenSourceFile],
  );

  return (
    <section className="intent-canvas-editor" aria-label={t("意图画布编辑器")}>
      <header className="intent-canvas-editor-topbar">
        <div className="intent-canvas-editor-titlebar">
          <button type="button" className="intent-canvas-icon-button" onClick={() => (isDirty ? setBackConfirmOpen(true) : onBack())}>
            <ArrowLeft aria-hidden />
            <span>{t("返回管理")}</span>
          </button>
          <div className="intent-canvas-editor-title-meta">
            <h2>{title.trim() || t("未命名意图画布")}</h2>
          </div>
        </div>
        {onOpenProjectMap && hasProjectMapImportSource ? (
          <button type="button" className="intent-canvas-source-link" onClick={onOpenProjectMap}>
            {t("返回项目知识地图")}
          </button>
        ) : null}
        <div className="intent-canvas-editor-actions">
          <span className={cn("intent-canvas-save-state", isDirty && "is-dirty")}>
            {isSaving ? t("保存中...") : isDirty ? t("未保存") : t("已保存")}
          </span>
          <button type="button" onClick={() => void handleSave()} disabled={isSaving}>
            <FloppyDisk aria-hidden />
            {t("保存")}
          </button>
          <button
            type="button"
            className="is-primary"
            onClick={() => void handleAttachToThread()}
            disabled={isSaving || !onAttachToThread || !activeThreadId}
          >
            <ChatText aria-hidden />
            {t("关联当前会话")}
          </button>
        </div>
      </header>

      <div
        className={cn(
          "intent-canvas-editor-body",
          leftRailCollapsed && "is-left-collapsed",
          rightRailCollapsed && "is-right-collapsed",
        )}
      >
        <EditorLeftRail
          collapsed={leftRailCollapsed}
          onToggleCollapsed={() => setLeftRailCollapsed((current) => !current)}
          title={title}
          summary={summary}
          fileLinksText={fileLinksText}
          nodeLinksText={nodeLinksText}
          threadLinksText={threadLinksText}
          activeThreadId={activeThreadId}
          onTitleChange={(value) => metadataChange(() => draft.setTitle(value))}
          onSummaryChange={(value) => metadataChange(() => draft.setSummary(value))}
          onFileLinksChange={(value) => metadataChange(() => draft.setFileLinksText(value))}
          onNodeLinksChange={(value) => metadataChange(() => draft.setNodeLinksText(value))}
          onThreadLinksChange={(value) => metadataChange(() => draft.setThreadLinksText(value))}
        />

        <main className="intent-canvas-excalidraw-shell">
          <Suspense
            fallback={
              <div className="intent-canvas-loading">
                <CircleNotch aria-hidden className="is-spinning" /> {t("正在加载画布...")}
              </div>
            }
          >
            <LazyExcalidraw
              key={document.id}
              excalidrawAPI={handleExcalidrawApi}
              initialData={initialData}
              onChange={handleSceneChange}
              name={title.trim() || document.title}
              langCode={langCode}
              gridModeEnabled
              objectsSnapModeEnabled
              theme={excalidrawTheme}
              UIOptions={{
                canvasActions: {
                  loadScene: false,
                  saveToActiveFile: false,
                  export: false,
                },
              }}
            />
          </Suspense>
        </main>

        <EditorRightRail
          collapsed={rightRailCollapsed}
          onToggleCollapsed={() => setRightRailCollapsed((current) => !current)}
          elementCount={elementCount}
          fileCount={parseCount(fileLinksText)}
          nodeCount={parseCount(nodeLinksText)}
          traceability={traceabilityProjection}
          sourceState={{ status: "idle", value: null, error: null }}
          transmissionContextJson={transmissionContextJson}
          errorText={saveError ?? managerErrorMessage}
          onOpenBacklink={handleOpenBacklink}
          onOpenSourceFile={onOpenSourceFile}
          onOpenProjectMap={onOpenProjectMap}
        />
      </div>

      <footer className="intent-canvas-editor-statusbar">
        <span>{document.id}</span>
        <span>{document.mode}</span>
        <span>{t("更新于 {time}", { time: formatDateTime(document.updatedAt) })}</span>
      </footer>
      {isBackConfirmOpen ? (
        <div className="intent-canvas-editor-confirm-overlay">
          <ConfirmBubble
            title={t("放弃未保存的修改?")}
            message={t("画布有未保存的编辑,返回管理将丢弃这些修改。")}
            confirmLabel={t("丢弃并返回")}
            onCancel={() => setBackConfirmOpen(false)}
            onConfirm={() => {
              setBackConfirmOpen(false);
              onBack();
            }}
          />
        </div>
      ) : null}
    </section>
  );
}

function parseCount(text: string): number {
  return Array.from(new Set(text.split(/\r?\n|,/g).map((item) => item.trim()).filter(Boolean))).length;
}
