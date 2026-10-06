/**
 * 编辑器草稿/保存/关联状态(自 IntentCanvasEditor 抽出,守行数铁则)。
 * 封装:脏标记、草稿构建(含活动会话绑定)、保存、关联当前会话、传输上下文预览。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { t } from "@kernel/i18n";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { IntentCanvasDocument } from "../types";
import { buildIntentCanvasTransmissionContext } from "../utils/context";
import { buildIntentCanvasAiContext, sanitizeIntentCanvasScene } from "../scene/sceneState";
import { linksToText, normalizeError, parseMultilineLinks } from "./EditorShared";

type UseEditorDraftInput = {
  document: IntentCanvasDocument;
  activeThreadId: string | null;
  onSave: (document: IntentCanvasDocument) => Promise<IntentCanvasDocument>;
  onAttachToThread?: (document: IntentCanvasDocument) => Promise<void> | void;
  /** 右栏展开态才驱动 transmissionContextJson 重算(性能闸,默认开供测试)。 */
  contextPreviewActive?: boolean;
};

export function useEditorDraft({
  document,
  activeThreadId,
  onSave,
  onAttachToThread,
  contextPreviewActive = true,
}: UseEditorDraftInput) {
  const [title, setTitle] = useState(document.title);
  const [summary, setSummary] = useState(document.summary);
  const [fileLinksText, setFileLinksText] = useState(() => linksToText(document.links.filePaths));
  const [nodeLinksText, setNodeLinksText] = useState(() => linksToText(document.links.projectMapNodeIds));
  const [threadLinksText, setThreadLinksText] = useState(() => linksToText(document.links.threadIds));
  const [isDirty, setIsDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /* 场景版本号:sceneRef 不触发渲染依赖,右栏 AI Context 预览靠它随画布重算。 */
  const [sceneVersion, setSceneVersion] = useState(0);
  const [elementCount, setElementCount] = useState(
    () => document.scene.elements.filter((element) => !element.isDeleted).length,
  );
  const sceneRef = useRef(document.scene);
  /* onChange 原始三件套(G1,2026-10-06):每帧只存引用零处理 —— sanitize+
   * repair 是 O(全部元素) 的重活,挪到保存/构建草稿时跑一次;在场即优先于
   * sceneRef(编辑过的场景才是真相)。 */
  const rawSceneRef = useRef<{
    elements: readonly OrderedExcalidrawElement[];
    appState: AppState;
    files: BinaryFiles;
  } | null>(null);
  const loadedIdRef = useRef(document.id);

  // eslint-disable-next-line react-doctor/no-adjust-state-on-prop-change -- 打开新画布时重置草稿字段属有意重置,key 已随文档切换重建
  useEffect(() => {
    const idChanged = loadedIdRef.current !== document.id;
    loadedIdRef.current = document.id;
    /* 同 id 的保存回写/重新打开不重置草稿字段(G2b):保存含数轮磁盘 IO,
     * 窗口内用户在标题/摘要/链接框的键入会被旧快照静默回滚;未保存的画布
     * 编辑(rawSceneRef)同样跨保存/重开存活 —— stale 闸要求「返回列表重新
     * 打开后再保存」的流,重开后直接保存即用最新内容。sceneRef 无条件跟随
     * (重开基线),raw 在场时 buildDraft 仍优先 raw。dirty 由保存成功自清。 */
    if (idChanged) {
      setTitle(document.title);
      setSummary(document.summary);
      setFileLinksText(linksToText(document.links.filePaths));
      setNodeLinksText(linksToText(document.links.projectMapNodeIds));
      setThreadLinksText(linksToText(document.links.threadIds));
      setIsDirty(false);
      setSaveError(null);
      rawSceneRef.current = null;
      setElementCount(document.scene.elements.filter((element) => !element.isDeleted).length);
    }
    sceneRef.current = document.scene;
  }, [document]);

  const markDirty = useCallback(() => {
    setIsDirty(true);
    setSaveError(null);
  }, []);

  const handleSceneChange = useCallback(
    (
      elements: readonly OrderedExcalidrawElement[],
      appState: AppState,
      files: BinaryFiles,
    ) => {
      rawSceneRef.current = { elements, appState, files };
      /* bail-out 型 setState:同值返回原引用,React 跳过渲染 —— 稳态编辑帧
       * 零重渲染(dirty 沿 false→true 只渲染一次;计数变了才渲染)。
       * sceneVersion 仅右栏预览展开时推进(收起时无人消费,展开瞬间 deps
       * 变化自然重算一次最新值)。 */
      setIsDirty((dirty) => (dirty ? dirty : true));
      setElementCount((count) => {
        const next = elements.filter((element) => !element.isDeleted).length;
        return next === count ? count : next;
      });
      if (contextPreviewActive) setSceneVersion((version) => version + 1);
    },
    [contextPreviewActive],
  );



  const buildDraftDocument = useCallback(

    (options: { includeActiveThread: boolean }): IntentCanvasDocument => {

      const threadIds = parseMultilineLinks(threadLinksText);

      const nextThreadIds =

        options.includeActiveThread && activeThreadId

          ? Array.from(new Set([...threadIds, activeThreadId]))

          : threadIds;

      const safeTitle = title.trim() || t("未命名意图画布");

      const safeSummary = summary.trim();

      /* sanitize 从每帧路径挪到这里(保存/预览构建时一次,G1);未编辑过
       * (rawSceneRef 空)时 sceneRef 已是正规化场景。 */
      const nextScene = rawSceneRef.current
        ? sanitizeIntentCanvasScene(rawSceneRef.current.elements, rawSceneRef.current.appState, rawSceneRef.current.files)
        : sceneRef.current;

      return {

        ...document,

        title: safeTitle,

        summary: safeSummary,

        links: {

          filePaths: parseMultilineLinks(fileLinksText),

          projectMapNodeIds: parseMultilineLinks(nodeLinksText),

          threadIds: nextThreadIds,

        },

        scene: nextScene,

        aiContext: buildIntentCanvasAiContext(nextScene, safeSummary),

      };

    },

    [activeThreadId, document, fileLinksText, nodeLinksText, summary, threadLinksText, title],

  );



  const handleSave = useCallback(async () => {

    try {

      const savedDocument = await onSave(buildDraftDocument({ includeActiveThread: false }));

      setIsDirty(false);

      setSaveError(null);

      return savedDocument;

    } catch (error) {

      const message = normalizeError(error);

      setSaveError(message);

      return null;

    }

  }, [buildDraftDocument, onSave]);



  const handleAttachToThread = useCallback(async () => {

    if (!onAttachToThread) {

      return;

    }

    try {

      const savedDocument = await onSave(buildDraftDocument({ includeActiveThread: true }));

      setIsDirty(false);

      setSaveError(null);

      await onAttachToThread(savedDocument);

    } catch (error) {

      setSaveError(normalizeError(error));

    }

  }, [buildDraftDocument, onAttachToThread, onSave]);



  const metadataChange = useCallback((next: () => void) => {

    next();

    markDirty();

  }, [markDirty]);


  const transmissionContextJson = useMemo(
    () => JSON.stringify(
      buildIntentCanvasTransmissionContext(buildDraftDocument({ includeActiveThread: false })),
      null,
      2,
    ),
    // 场景编辑经 sceneVersion 通知(见 handleSceneChange);其余键 = buildDraftDocument 依赖。
    // 右栏折叠时冻结计算(产物无人消费,大画布每变更帧的 stringify 与
    // Excalidraw 渲染抢主线程 —— 评审 P1)。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [buildDraftDocument, contextPreviewActive ? sceneVersion : -1],
  );

  return {
    title, setTitle, summary, setSummary,
    fileLinksText, setFileLinksText, nodeLinksText, setNodeLinksText,
    threadLinksText, setThreadLinksText,
    isDirty, saveError, setSaveError, elementCount,
    handleSceneChange, buildDraftDocument, handleSave, handleAttachToThread,
    metadataChange, transmissionContextJson,
  };
}

