/**
 * 意图画布 · 画布文档核心类型(文档/索引/场景/关联;mossx types.ts 拆分,移植)。
 * 语义图层类型见 ./semantic,经下方 re-export 保持 `from "../types"` 引用面不变。
 */
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type {
  IntentCanvasAiContext,
  IntentCanvasLinks,
  IntentCanvasOpenTarget,
  IntentCanvasMode,
  CanvasSemanticGraph,
  CanvasAiAnnotation,
} from "./semantic";
export type {
  IntentCanvasMode,
  IntentCanvasOpenTarget,
  IntentCanvasCodeSelectionAnchor,
  IntentCanvasElementDigest,
  IntentCanvasRelationDigest,
  IntentCanvasAiContext,
  IntentCanvasContextCompleteness,
  IntentCanvasTransmissionSemanticNode,
  IntentCanvasTransmissionSemanticEdge,
  IntentCanvasTransmissionEvidence,
  IntentCanvasTransmissionVisualArrow,
  IntentCanvasTransmissionContext,
  IntentCanvasLinks,
  SourceRange,
  CanvasCodeSymbolKind,
  CanvasSourceAnchor,
  CanvasSemanticNodeType,
  CanvasSemanticNode,
  CanvasSemanticEdgeDirection,
  CanvasEvidenceRef,
  CanvasSemanticEdge,
  CanvasSemanticGraph,
  CanvasAiAnnotation,
  IntentCanvasContextCount,
  IntentCanvasContextSendAttachment,
} from "./semantic";

export type IntentCanvasWorkspaceRef = {
  id: string;
  name: string | null;
};

export type IntentCanvasOpenSource = {
  projectMapNodeId?: string | null;
  nodeTitle?: string | null;
  nodeKind?: string | null;
  summary?: string | null;
  filePath?: string | null;
};

export type IntentCanvasOpenRequest = {
  requestId: number;
  mode: IntentCanvasMode;
  target?: IntentCanvasOpenTarget | null;
  canvasId?: string | null;
  title?: string | null;
  summary?: string | null;
  seedSemanticGraphs?: CanvasSemanticGraph[];
  source?: IntentCanvasOpenSource | null;
};


export type IntentCanvasScene = {
  elements: readonly OrderedExcalidrawElement[];
  appState: Partial<AppState>;
  files: BinaryFiles;
};

export type IntentCanvasDocument = {
  version: 1;
  id: string;
  title: string;
  kind: "intent-canvas";
  createdAt: string;
  updatedAt: string;
  workspace: IntentCanvasWorkspaceRef;
  mode: IntentCanvasMode;
  summary: string;
  links: IntentCanvasLinks;
  scene: IntentCanvasScene;
  aiContext: IntentCanvasAiContext;
  semanticGraphs: CanvasSemanticGraph[];
  aiAnnotations: CanvasAiAnnotation[];
};

export type IntentCanvasIndexEntry = {
  id: string;
  title: string;
  mode: IntentCanvasMode;
  summary: string;
  updatedAt: string;
  createdAt: string;
  path: string;
  linkedFileCount: number;
  linkedProjectMapNodeCount: number;
  linkedThreadCount: number;
  elementCount: number;
  /** 列表卡片缩略图（保存时生成；旧 index 缺省，超预算不写）。 */
  thumbnailSvg?: string;
};

export type IntentCanvasIndexFile = {
  version: 1;
  canvases: IntentCanvasIndexEntry[];
};

export type IntentCanvasLoadResult<T> = {
  value: T;
  warnings: string[];
};
