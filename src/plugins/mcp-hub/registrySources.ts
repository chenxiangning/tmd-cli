/**
 * 三源 registry 网络客户端 —— 全走 ipc.quotaFetch(通用 HTTP 代理,R3 纪律);
 * 纯归一在 registryNormalize(可测),本层只拼 URL/发请求/解分页。
 * 单源不可达 = 抛错(StoreView 落该源空态 + 错误提示,不白屏)。
 * 端点(公开 API,行为契约 2026-09-28 实测):
 * - official registry.modelcontextprotocol.io/v0.1/servers?limit&search&cursor
 * - smithery api.smithery.ai/servers?q&pageSize&page;详情 /servers/{qualifiedName}
 * - glama glama.ai/api/mcp/v1/servers?first&query&after(现需 API key,401 → 源级空态)
 */

import { ipc } from "@kernel/ipc";
import {
  applySmitheryDetail,
  asArray,
  asNumber,
  asRecord,
  normalizeGlama,
  normalizeOfficial,
  normalizeSmitherySearch,
  type RegistryCard,
  type RegistrySourceName,
} from "./registryNormalize";

export type { RegistrySourceName } from "./registryNormalize";

export interface RegistrySearchParams {
  source: RegistrySourceName;
  query?: string;
  cursor?: string;
  limit?: number;
}

export interface RegistryResult {
  source: RegistrySourceName;
  items: RegistryCard[];
  nextCursor?: string;
  totalCount?: number;
}

const OFFICIAL_BASE = "https://registry.modelcontextprotocol.io/v0.1";
const SMITHERY_API = "https://api.smithery.ai";
const GLAMA_API = "https://glama.ai";
const DEFAULT_LIMIT = 24;

function buildUrl(base: string, path: string, params: Record<string, string | undefined>): string {
  const url = new URL(base + path);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, value);
  }
  return url.toString();
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await ipc.quotaFetch({ url });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.body;
}

function normalizeLimit(limit: number | undefined): number {
  return limit && limit > 0 && limit <= 100 ? limit : DEFAULT_LIMIT;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function normalizeCards(raw: unknown, normalize: (item: unknown) => RegistryCard | null): RegistryCard[] {
  return asArray(raw).map(normalize).filter((c): c is RegistryCard => c !== null);
}

export const REGISTRY_SOURCES: { id: RegistrySourceName; label: string }[] = [
  { id: "official", label: "Official" },
  { id: "smithery", label: "Smithery" },
  { id: "glama", label: "Glama" },
];

async function searchOfficial(params: RegistrySearchParams): Promise<RegistryResult> {
  const url = buildUrl(OFFICIAL_BASE, "/servers", {
    limit: String(normalizeLimit(params.limit)),
    search: params.query?.trim(),
    cursor: params.cursor,
  });
  const json = asRecord(await fetchJson(url));
  const metadata = asRecord(json.metadata);
  return {
    source: "official",
    items: normalizeCards(json.servers, normalizeOfficial),
    nextCursor: asString(metadata.nextCursor),
    totalCount: asNumber(metadata.count),
  };
}

async function searchSmithery(params: RegistrySearchParams): Promise<RegistryResult> {
  const page = params.cursor ?? "1";
  const url = buildUrl(SMITHERY_API, "/servers", {
    q: params.query?.trim(),
    pageSize: String(normalizeLimit(params.limit)),
    page,
  });
  const json = asRecord(await fetchJson(url));
  const pagination = asRecord(json.pagination);
  const currentPage = asNumber(pagination.currentPage) ?? Number(page);
  const totalPages = asNumber(pagination.totalPages);
  return {
    source: "smithery",
    items: normalizeCards(json.servers, normalizeSmitherySearch),
    nextCursor: totalPages !== undefined && currentPage < totalPages ? String(currentPage + 1) : undefined,
    totalCount: asNumber(pagination.totalCount),
  };
}

async function searchGlama(params: RegistrySearchParams): Promise<RegistryResult> {
  const url = buildUrl(GLAMA_API, "/api/mcp/v1/servers", {
    first: String(normalizeLimit(params.limit)),
    query: params.query?.trim(),
    after: params.cursor,
  });
  const json = asRecord(await fetchJson(url));
  const pageInfo = asRecord(json.pageInfo);
  return {
    source: "glama",
    items: normalizeCards(json.servers, normalizeGlama),
    nextCursor: pageInfo.hasNextPage === true ? asString(pageInfo.endCursor) : undefined,
  };
}

/** 搜索一个源;源不可达/接口变化 = 抛错(调用方落空态)。 */
export async function searchRegistrySource(params: RegistrySearchParams): Promise<RegistryResult> {
  if (params.source === "official") return searchOfficial(params);
  if (params.source === "smithery") return searchSmithery(params);
  return searchGlama(params);
}

/** Smithery 搜索卡无草稿:打开安装弹窗前拉详情补 installDraft/manualDraft。 */
export async function resolveSmitheryDraft(card: RegistryCard): Promise<RegistryCard> {
  if (card.source !== "smithery" || card.installDraft || card.manualDraft) return card;
  const path = card.name.split("/").map(encodeURIComponent).join("/");
  const detail = await fetchJson(`${SMITHERY_API}/servers/${path}`);
  return applySmitheryDetail(card, detail);
}
