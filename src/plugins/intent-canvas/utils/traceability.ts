import type {
  CanvasEvidenceRef,
  CanvasSemanticEdge,
  CanvasSemanticGraph,
  CanvasSemanticNode,
  CanvasSourceAnchor,
} from "../types";
/** 导入源运行态:tmd-cli 无 project-map 扫描器;AI/未来扩展产出 semanticGraphs 时
 *  按同契约提供最新扫描 id 集合,判定锚点解析与过期。 */
export type CanvasImportSourceState = {
  exists: boolean;
  scan: { scanRunId: string; snapshotVersion?: string | null } | null;
  fileNodeIds: Set<string>;
  relationEdgeIds: Set<string>;
};

function isImportScanFresh(input: { importedScanRunId: string; latestScanRunId?: string | null }): boolean {
  return Boolean(input.latestScanRunId) && input.importedScanRunId === input.latestScanRunId;
}

export type IntentCanvasSourceLocation = { line: number; column: number };


const EMPTY_SOURCE_BACKLINKS: IntentCanvasSourceBacklink[] = [];
const EMPTY_EVIDENCE_BACKLINKS: IntentCanvasEvidenceBacklink[] = [];

export type RelationshipSourceRuntimeState =
  | { status: "idle"; value: null; error: null }
  | { status: "loading"; value: null; error: null }
  | { status: "ready"; value: CanvasImportSourceState; error: null }
  | { status: "error"; value: null; error: string };

export type IntentCanvasSourceBacklink = {
  id: string;
  label: string;
  detail: string;
  path: string;
  location: IntentCanvasSourceLocation | null;
  unresolved: boolean;
};

export type IntentCanvasEvidenceBacklink = {
  id: string;
  label: string;
  detail: string;
  path: string | null;
  location: IntentCanvasSourceLocation | null;
  evidenceIds: string[];
  unresolved: boolean;
};

export type IntentCanvasTraceabilityProjection = {
  importedGraphCount: number;
  staleGraphCount: number;
  unresolvedAnchorCount: number;
  refreshableGraphCount: number;
  codeSelectionBacklinks: IntentCanvasSourceBacklink[];
  sourceBacklinks: IntentCanvasSourceBacklink[];
  evidenceBacklinks: IntentCanvasEvidenceBacklink[];
};


export function isProjectMapRelationshipGraph(graph: CanvasSemanticGraph): boolean {
  return graph.sourceSnapshot?.kind === "project-map-relations";
}

export function getSourceAnchorPath(anchor: CanvasSourceAnchor | null | undefined): string | null {
  if (!anchor) {
    return null;
  }
  if (anchor.kind === "code-symbol") {
    return anchor.filePath;
  }
  if (anchor.kind === "relationship-node") {
    return anchor.filePath ?? null;
  }
  return null;
}

export function normalizeSourceColumn(value: number | null | undefined): number {
  return value && value > 0 ? value : 1;
}

export function getSourceAnchorLocation(anchor: CanvasSourceAnchor | null | undefined): IntentCanvasSourceLocation | null {
  if (!anchor || anchor.kind !== "code-symbol") {
    return null;
  }
  const range = anchor.definitionRange ?? anchor.selectionRange ?? null;
  if (!range?.startLine || range.startLine < 1) {
    return null;
  }
  return {
    line: range.startLine,
    column: normalizeSourceColumn(range.startColumn),
  };
}

export function getEvidenceRefLocation(ref: CanvasEvidenceRef | null | undefined): IntentCanvasSourceLocation | null {
  if (!ref?.line || ref.line < 1) {
    return null;
  }
  return { line: ref.line, column: 1 };
}

export function isRelationshipAnchorRuntimeUnresolved(
  anchor: CanvasSourceAnchor | null | undefined,
  sourceState: CanvasImportSourceState | null,
): boolean {
  if (!anchor || !sourceState || anchor.kind === "code-symbol") {
    return false;
  }
  if (!sourceState.exists) {
    return true;
  }
  if (anchor.kind === "relationship-node") {
    return !sourceState.fileNodeIds.has(anchor.nodeId);
  }
  return !sourceState.relationEdgeIds.has(anchor.edgeId);
}

export function isRelationshipAnchorRuntimeResolved(
  anchor: CanvasSourceAnchor | null | undefined,
  sourceState: CanvasImportSourceState | null,
): boolean {
  if (!anchor || !sourceState?.exists || anchor.kind === "code-symbol") {
    return false;
  }
  if (anchor.kind === "relationship-node") {
    return sourceState.fileNodeIds.has(anchor.nodeId);
  }
  return sourceState.relationEdgeIds.has(anchor.edgeId);
}

export function isGraphSnapshotStale(
  graph: CanvasSemanticGraph,
  sourceState: CanvasImportSourceState | null,
): boolean {
  const importedScanRunId = graph.sourceSnapshot?.scanRunId;
  if (!importedScanRunId || !sourceState?.scan?.scanRunId) {
    return false;
  }
  return !isImportScanFresh({
    importedScanRunId,
    latestScanRunId: sourceState.scan.scanRunId,
  });
}

export function isGraphRefreshable(
  graph: CanvasSemanticGraph,
  sourceState: CanvasImportSourceState | null,
): boolean {
  return graph.nodes.some((node) => isRelationshipAnchorRuntimeResolved(node.sourceAnchor, sourceState))
    || graph.edges.some((edge) => isRelationshipAnchorRuntimeResolved(edge.sourceAnchor, sourceState));
}

export function createSourceBacklink(input: {
  graph: CanvasSemanticGraph;
  node: CanvasSemanticNode;
  sourceState: CanvasImportSourceState | null;
}): IntentCanvasSourceBacklink | null {
  const path = getSourceAnchorPath(input.node.sourceAnchor);
  if (!path) {
    return null;
  }
  const location = getSourceAnchorLocation(input.node.sourceAnchor);
  return {
    id: `${input.graph.graphId}:node:${input.node.id}`,
    label: input.node.label,
    detail: location ? `${path}:${location.line}` : path,
    path,
    location,
    unresolved: Boolean(input.node.unresolved)
      || isRelationshipAnchorRuntimeUnresolved(input.node.sourceAnchor, input.sourceState),
  };
}

export function createEvidenceBacklink(input: {
  graph: CanvasSemanticGraph;
  edge: CanvasSemanticEdge;
  sourceState: CanvasImportSourceState | null;
}): IntentCanvasEvidenceBacklink | null {
  const evidenceIds = input.edge.evidenceIds ?? [];
  const evidenceRefs = input.edge.evidenceRefs ?? [];
  if (!evidenceIds.length && !evidenceRefs.length) {
    return null;
  }
  const primaryRef = evidenceRefs.find((ref) => Boolean(ref.path)) ?? evidenceRefs[0] ?? null;
  const path = primaryRef?.path?.trim() || null;
  return {
    id: `${input.graph.graphId}:edge:${input.edge.id}`,
    label: input.edge.label ?? input.edge.relationKind,
    detail: primaryRef?.label ?? evidenceIds[0] ?? input.edge.relationKind,
    path,
    location: getEvidenceRefLocation(primaryRef),
    evidenceIds,
    unresolved: Boolean(input.edge.unresolved)
      || isRelationshipAnchorRuntimeUnresolved(input.edge.sourceAnchor, input.sourceState),
  };
}

export function formatCodeSelectionLineLabel(startLine: number, endLine: number): string {
  return startLine === endLine ? `L${startLine}` : `L${startLine}-L${endLine}`;
}

export function getCodeSelectionFileName(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath;
}

export function createCodeSelectionBacklink(graph: CanvasSemanticGraph): IntentCanvasSourceBacklink | null {
  const selection = graph.sourceSelection;
  if (!selection?.filePath) {
    return null;
  }
  const lineLabel = formatCodeSelectionLineLabel(selection.startLine, selection.endLine);
  return {
    id: `${graph.graphId}:code-selection:${selection.filePath}:${lineLabel}`,
    label: selection.symbolName,
    detail: `${getCodeSelectionFileName(selection.filePath)} · ${lineLabel}`,
    path: selection.filePath,
    location: {
      line: selection.declarationLine,
      column: 1,
    },
    unresolved: false,
  };
}

export function buildTraceabilityProjection(
  graphs: CanvasSemanticGraph[],
  sourceState: CanvasImportSourceState | null,
): IntentCanvasTraceabilityProjection {
  const codeSelectionBacklinks = new Map<string, IntentCanvasSourceBacklink>();
  graphs.forEach((graph) => {
    const codeSelectionBacklink = createCodeSelectionBacklink(graph);
    if (codeSelectionBacklink) {
      codeSelectionBacklinks.set(codeSelectionBacklink.id, codeSelectionBacklink);
    }
  });

  const relationshipGraphs = graphs.filter(isProjectMapRelationshipGraph);
  if (!relationshipGraphs.length) {
    return {
      importedGraphCount: 0,
      staleGraphCount: 0,
      unresolvedAnchorCount: 0,
      refreshableGraphCount: 0,
      codeSelectionBacklinks: Array.from(codeSelectionBacklinks.values()),
      sourceBacklinks: EMPTY_SOURCE_BACKLINKS,
      evidenceBacklinks: EMPTY_EVIDENCE_BACKLINKS,
    };
  }

  const sourceBacklinks = new Map<string, IntentCanvasSourceBacklink>();
  const evidenceBacklinks = new Map<string, IntentCanvasEvidenceBacklink>();
  let unresolvedAnchorCount = 0;

  relationshipGraphs.forEach((graph) => {
    graph.nodes.forEach((node) => {
      if (Boolean(node.unresolved) || isRelationshipAnchorRuntimeUnresolved(node.sourceAnchor, sourceState)) {
        unresolvedAnchorCount += 1;
      }
      const backlink = createSourceBacklink({ graph, node, sourceState });
      if (backlink) {
        sourceBacklinks.set(`${backlink.path}:${backlink.location?.line ?? ""}:${backlink.label}`, backlink);
      }
    });
    graph.edges.forEach((edge) => {
      if (Boolean(edge.unresolved) || isRelationshipAnchorRuntimeUnresolved(edge.sourceAnchor, sourceState)) {
        unresolvedAnchorCount += 1;
      }
      const backlink = createEvidenceBacklink({ graph, edge, sourceState });
      if (backlink) {
        evidenceBacklinks.set(backlink.id, backlink);
      }
    });
  });

  return {
    importedGraphCount: relationshipGraphs.length,
    staleGraphCount: relationshipGraphs.filter((graph) => isGraphSnapshotStale(graph, sourceState)).length,
    unresolvedAnchorCount,
    refreshableGraphCount: relationshipGraphs.filter((graph) => isGraphRefreshable(graph, sourceState)).length,
    codeSelectionBacklinks: Array.from(codeSelectionBacklinks.values()),
    sourceBacklinks: Array.from(sourceBacklinks.values()),
    evidenceBacklinks: Array.from(evidenceBacklinks.values()),
  };
}
