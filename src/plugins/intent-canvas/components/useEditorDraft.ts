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
};

export function useEditorDraft({
  document,
  activeThreadId,
  onSave,
  onAttachToThread,
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

  useEffect(() => {
    setTitle(document.title);
    setSummary(document.summary);
    setFileLinksText(linksToText(document.links.filePaths));
    setNodeLinksText(linksToText(document.links.projectMapNodeIds));
    setThreadLinksText(linksToText(document.links.threadIds));
    setIsDirty(false);
    setSaveError(null);
    sceneRef.current = document.scene;
    setElementCount(document.scene.elements.filter((element) => !element.isDeleted).length);
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

      const nextScene = sanitizeIntentCanvasScene(elements, appState, files);

      sceneRef.current = nextScene;

      setElementCount(elements.filter((element) => !element.isDeleted).length);

      setSceneVersion((version) => version + 1);

      setIsDirty(true);

    },

    [],

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

      const nextScene = sceneRef.current;

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [buildDraftDocument, sceneVersion],
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

