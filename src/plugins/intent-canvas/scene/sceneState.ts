/**
 * 意图画布 · 场景引擎(mossx utils/scene.ts 966 行按职责拆分,移植)。
 * 本文件:种子图形与元素工厂;graph:语义图投影;repair:生成元素修复;state:sanitize/初始场景/AI 上下文。
  * 本文件:appState 白名单 sanitize、初始场景、AI 上下文摘要。
 */
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type {
  CanvasSemanticGraph,
  IntentCanvasAiContext,
  IntentCanvasElementDigest,
  IntentCanvasOpenSource,
  IntentCanvasRelationDigest,
  IntentCanvasScene,
} from "../types";
import {
  createSeedElement,
  finiteNumber,
  isIntentCanvasElement,
  readElementLabel,
} from "./sceneElements";
import { buildGraphSeedSkeleton } from "./sceneGraph";
import { buildSeedSkeleton } from "./sceneSeedSkeleton";

import { repairIntentCanvasGeneratedElements } from "./sceneRepair";

export { repairIntentCanvasGeneratedElements };
import { isRecord, toJsonObject } from "../utils/json";

const EXCALIDRAW_RUNTIME_APP_STATE_KEYS = new Set(["collaborators"]);
const EXCALIDRAW_OBJECT_MAP_APP_STATE_KEYS = new Set(["selectedElementIds", "selectedGroupIds"]);

function sanitizeIntentCanvasAppState(appState: Partial<AppState> | unknown): Partial<AppState> {
  if (!isRecord(appState)) {
    return {};
  }
  const safeAppState = Object.entries(appState).reduce<Record<string, unknown>>(
    (current, [key, value]) => {
      if (!EXCALIDRAW_RUNTIME_APP_STATE_KEYS.has(key)) {
        current[key] = EXCALIDRAW_OBJECT_MAP_APP_STATE_KEYS.has(key) && !isRecord(value)
          ? {}
          : value === appState
            ? null
            : value;
      }
      return current;
    },
    {},
  );
  return toJsonObject(safeAppState) as Partial<AppState>;
}

export function sanitizeIntentCanvasScene(
  elements: readonly OrderedExcalidrawElement[] | readonly unknown[],
  appState: Partial<AppState> | unknown,
  files: BinaryFiles | unknown,
): IntentCanvasScene {
  const safeElements: OrderedExcalidrawElement[] = [];
  elements.forEach((element) => {
    if (isIntentCanvasElement(element)) {
      safeElements.push(element);
    }
  });
  return {
    elements: repairIntentCanvasGeneratedElements(safeElements),
    appState: sanitizeIntentCanvasAppState(appState),
    files: toJsonObject(files) as BinaryFiles,
  };
}

export function createInitialIntentCanvasScene(
  source?: IntentCanvasOpenSource | null,
  seedSemanticGraphs?: CanvasSemanticGraph[],
): IntentCanvasScene {
  const graphSeedSkeleton = buildGraphSeedSkeleton(seedSemanticGraphs);
  const elements = (graphSeedSkeleton.length ? graphSeedSkeleton : buildSeedSkeleton(source)).map(createSeedElement);
  return sanitizeIntentCanvasScene(
    elements,
    {
      viewBackgroundColor: "#fbfaf7",
      gridSize: 20,
      zoom: { value: 1 },
      scrollX: 0,
      scrollY: 0,
    },
    {},
  );
}

export function buildIntentCanvasAiContext(
  scene: IntentCanvasScene,
  summary: string,
): IntentCanvasAiContext {
  const elementDigest: IntentCanvasElementDigest[] = [];
  const relationDigest: IntentCanvasRelationDigest[] = [];

  scene.elements.forEach((element) => {
    const rawElement = element as unknown as Record<string, unknown>;
    if (rawElement.isDeleted === true) {
      return;
    }
    const type = typeof rawElement.type === "string" ? rawElement.type : "unknown";
    const id = typeof rawElement.id === "string" ? rawElement.id : `${type}-${elementDigest.length + 1}`;
    const label = readElementLabel(rawElement);
    if (type === "arrow" || type === "line") {
      const startBinding = isRecord(rawElement.startBinding) ? rawElement.startBinding : null;
      const endBinding = isRecord(rawElement.endBinding) ? rawElement.endBinding : null;
      relationDigest.push({
        id,
        type,
        label,
        startBindingId: typeof startBinding?.elementId === "string" ? startBinding.elementId : null,
        endBindingId: typeof endBinding?.elementId === "string" ? endBinding.elementId : null,
      });
    }
    elementDigest.push({
      id,
      type,
      label,
      x: finiteNumber(rawElement.x),
      y: finiteNumber(rawElement.y),
      width: finiteNumber(rawElement.width),
      height: finiteNumber(rawElement.height),
    });
  });

  return {
    elementDigest: elementDigest.slice(0, 80),
    relationDigest: relationDigest.slice(0, 80),
    lastContextSnapshot: JSON.stringify(
      {
        summary: summary.trim(),
        elements: elementDigest.slice(0, 40),
        relations: relationDigest.slice(0, 40),
      },
      null,
      2,
    ),
  };
}

