/**
 * LSP 位置换算管道 —— Location/LocationLink 归一、uri↔path、PeekItem 映射、
 * 区间包含判定。自 cmLsp.ts 拆出(文件规模铁则)。
 */

import { lspToOffset, type LspRange } from "@kernel/lsp/lspPosition";
import { normalizePath } from "@kernel/pathUtils";
import type { PeekItem } from "./peekWidget";

export interface LspLocation {
  uri: string;
  range: LspRange;
}

/** Location | Location[] | LocationLink[] | null → 统一 {uri, range}[]。 */
export function normalizeLocations(raw: unknown): LspLocation[] {
  const arr = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const out: LspLocation[] = [];
  for (const item of arr) {
    if (typeof item !== "object" || item === null) continue;
    const loc = item as Record<string, unknown>;
    const uri =
      typeof loc.uri === "string" ? loc.uri : typeof loc.targetUri === "string" ? loc.targetUri : null;
    const rawRange = loc.range ?? loc.targetRange;
    if (uri && typeof rawRange === "object" && rawRange !== null) {
      out.push({ uri, range: rawRange as LspRange });
    }
  }
  return out;
}

export function uriToPath(uri: string): string {
  return normalizePath(decodeURIComponent(uri.replace(/^file:\/\//, "")));
}

export function locToPeekItem(loc: LspLocation): PeekItem {
  return {
    path: uriToPath(loc.uri),
    line: loc.range.start.line + 1,
    startChar: loc.range.start.character,
    endChar: loc.range.end.line === loc.range.start.line ? loc.range.end.character : null,
  };
}

export function rangeContainsOffset(range: LspRange, doc: string, offset: number): boolean {
  return lspToOffset(doc, range.start) <= offset && offset <= lspToOffset(doc, range.end);
}
