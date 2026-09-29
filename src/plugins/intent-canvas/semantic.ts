/** 意图画布 · 语义图层类型:语义图/锚点/证据/AI 上下文/发送附件(mossx types.ts 拆分,移植)。 */
export type IntentCanvasMode = "architect" | "spotlight" | "file";
export type IntentCanvasOpenTarget = "new" | "append";

export type IntentCanvasLinks = {
  projectMapNodeIds: string[];
  filePaths: string[];
  threadIds: string[];
};

export type IntentCanvasCodeSelectionAnchor = {
  source: "active-editor-selection";
  filePath: string;
  startLine: number;
  endLine: number;
  declarationLine: number;
  symbolName: string;
  referenceTokens?: string[];
  symbolKind:
    | "class"
    | "method"
    | "function"
    | "property"
    | "interface"
    | "enum"
    | "record"
    | "type"
    | "struct"
    | "trait";
};


export type IntentCanvasElementDigest = {
  id: string;
  type: string;
  label: string | null;
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
};

export type IntentCanvasRelationDigest = {
  id: string;
  type: "arrow" | "line";
  label: string | null;
  startBindingId: string | null;
  endBindingId: string | null;
};

export type IntentCanvasAiContext = {
  elementDigest: IntentCanvasElementDigest[];
  relationDigest: IntentCanvasRelationDigest[];
  lastContextSnapshot: string;
};

export type IntentCanvasContextCompleteness = {
  elements: { total: number; sent: number; omitted: number };
  semanticNodes: { total: number; sent: number; omitted: number };
  semanticEdges: { total: number; sent: number; omitted: number };
  evidence: { total: number; sent: number; omitted: number };
  visualTextBlocks: { total: number; sent: number; omitted: number };
  visualArrows: { total: number; sent: number; omitted: number };
  unlabeledShapeCount: number;
  truncated: boolean;
  compressionMode: "compact" | "semantic" | "chunked";
};

export type IntentCanvasTransmissionSemanticNode = {
  id: string;
  label: string;
  kind: CanvasSemanticNodeType;
  filePath?: string | null;
  role?: string | null;
  summary?: string | null;
};

export type IntentCanvasTransmissionSemanticEdge = {
  id: string;
  source: string;
  target: string;
  relation: string;
  label?: string | null;
  evidenceIds?: string[];
};

export type IntentCanvasTransmissionEvidence = {
  id: string;
  summary: string;
};

export type IntentCanvasTransmissionVisualArrow = {
  id: string;
  from?: string | null;
  to?: string | null;
  label?: string | null;
};

export type IntentCanvasTransmissionContext = {
  type: "intent_canvas_context";
  version: 2;
  canvasId: string;
  title: string;
  mode: IntentCanvasMode;
  workspaceName: string | null;
  summary: string;
  links: IntentCanvasLinks;
  updatedAt: string;
  completeness: IntentCanvasContextCompleteness;
  semanticGraph: {
    nodes: IntentCanvasTransmissionSemanticNode[];
    edges: IntentCanvasTransmissionSemanticEdge[];
    evidence: IntentCanvasTransmissionEvidence[];
  };
  visualClues: {
    textBlocks: string[];
    arrows: IntentCanvasTransmissionVisualArrow[];
    unlabeledShapeCount: number;
  };
};

export type SourceRange = {
  startLine: number;
  startColumn?: number | null;
  endLine?: number | null;
  endColumn?: number | null;
};

export type CanvasCodeSymbolKind =
  | "function"
  | "method"
  | "class"
  | "module"
  | "unknown";

export type CanvasSourceAnchor =
  | {
      kind: "code-symbol";
      workspaceId: string;
      filePath: string;
      symbolName: string;
      symbolKind: CanvasCodeSymbolKind;
      scanRunId?: string | null;
      symbolId?: string | null;
      selectionRange?: SourceRange | null;
      definitionRange?: SourceRange | null;
      resolvedBy?: "relationship-symbols" | "editor-selection" | "fallback-text" | string;
    }
  | {
      kind: "relationship-node";
      workspaceId: string;
      scanRunId: string;
      nodeId: string;
      nodeKind: string;
      filePath?: string | null;
      symbolId?: string | null;
    }
  | {
      kind: "relationship-edge";
      workspaceId: string;
      scanRunId: string;
      edgeId: string;
      relationKind: string;
      sourceNodeId: string;
      targetNodeId: string;
      evidenceIds: string[];
    };

export type CanvasSemanticNodeType = "file" | "symbol" | "module" | "group" | "endpoint" | "unknown";

export type CanvasSemanticNode = {
  id: string;
  label: string;
  kind: CanvasSemanticNodeType;
  sourceAnchor?: CanvasSourceAnchor | null;
  evidenceIds?: string[];
  summary?: string | null;
  stale?: boolean;
  unresolved?: boolean;
};

export type CanvasSemanticEdgeDirection = "out" | "in" | "both" | "undirected";

export type CanvasEvidenceRef = {
  id: string;
  path?: string | null;
  line?: number | null;
  excerpt?: string | null;
  label?: string | null;
};

export type CanvasSemanticEdge = {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  relationKind: string;
  direction?: CanvasSemanticEdgeDirection;
  sourceAnchor?: CanvasSourceAnchor | null;
  label?: string | null;
  evidenceIds?: string[];
  evidenceRefs?: CanvasEvidenceRef[];
  evidenceSummary?: string[];
  stale?: boolean;
  unresolved?: boolean;
};

export type CanvasSemanticGraph = {
  graphId: string;
  createdAt: string;
  sourceSnapshot?: {
    kind: "project-map-relations";
    scanRunId: string;
    snapshotVersion?: string | null;
  };
  sourceSelection?: IntentCanvasCodeSelectionAnchor | null;
  nodes: CanvasSemanticNode[];
  edges: CanvasSemanticEdge[];
  importOptions?: {
    depth?: number | null;
    direction?: "callers" | "callees" | "both" | "neighborhood";
    centerNodeId?: string | null;
    maxNodes?: number | null;
    maxEdges?: number | null;
    omittedNodes?: number | null;
    omittedEdges?: number | null;
  };
};

export type CanvasAiAnnotation = {
  id: string;
  targetGraphId: string;
  targetNodeIds?: string[];
  targetEdgeIds?: string[];
  annotationKind: "summary" | "risk" | "group" | "next-step" | string;
  content: string;
  createdAt: string;
};

export type IntentCanvasContextCount = {
  total: number;
  sent: number;
  omitted: number;
};

