/**
 * ClawHub REST client ── 四端点(list/search/detail/download-url builder)+
 * owner 消歧编排。元数据请求走 quotaFetch(Accept: json;4xx/5xx 原样报错
 * 不重试);下载走 netDownload(quotaFetch body 通道装不下 zip 二进制)。
 */

import { ipc } from "@kernel/ipc";
import {
  buildClawHubDownloadUrl,
  buildClawHubWebUrl,
  normalizeClawHubCard,
  selectOwnerCandidate,
  type ClawHubCard,
  type ClawHubDetail,
  type ClawHubSort,
} from "./clawhubNormalize";

/** 非 2xx 响应(status + body 原样,供商店错误态/消歧候选展示)。 */
export class ClawHubHttpError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`ClawHub HTTP ${status}: ${body.slice(0, 300)}`);
    this.name = "ClawHubHttpError";
    this.status = status;
    this.body = body;
  }
}

async function clawhubJson(url: string): Promise<unknown> {
  const resp = await ipc.quotaFetch({ url, headers: { Accept: "application/json" } });
  if (resp.status < 200 || resp.status >= 300) {
    throw new ClawHubHttpError(
      resp.status,
      typeof resp.body === "string" ? resp.body : JSON.stringify(resp.body),
    );
  }
  return resp.body;
}

export interface ClawHubListResult {
  items: ClawHubCard[];
  nextCursor: string;
}

/** 技能列表(排序词表见 CLAWHUB_SORTS;cursor 分页)。 */
export async function listClawHubSkills(params: {
  sort: ClawHubSort;
  cursor?: string;
  limit?: number;
}): Promise<ClawHubListResult> {
  const url = new URL("/api/v1/skills", "https://clawhub.ai");
  url.searchParams.set("limit", String(params.limit ?? 24));
  url.searchParams.set("sort", params.sort);
  url.searchParams.set("nonSuspiciousOnly", "true");
  if (params.cursor) url.searchParams.set("cursor", params.cursor);
  const json = clawhubJsonRecord(await clawhubJson(url.toString()));
  const items = (Array.isArray(json.items) ? json.items : [])
    .map(normalizeClawHubCard)
    .filter((c): c is ClawHubCard => c !== null);
  return { items, nextCursor: typeof json.nextCursor === "string" ? json.nextCursor : "" };
}

/** 关键词搜索(搜索项是另一响应形态,归一化层已兼容)。 */
export async function searchClawHubSkills(params: {
  query: string;
  limit?: number;
}): Promise<ClawHubCard[]> {
  const url = new URL("/api/v1/search", "https://clawhub.ai");
  url.searchParams.set("q", params.query);
  url.searchParams.set("limit", String(params.limit ?? 24));
  url.searchParams.set("nonSuspiciousOnly", "true");
  const json = clawhubJsonRecord(await clawhubJson(url.toString()));
  return (Array.isArray(json.results) ? json.results : [])
    .map(normalizeClawHubCard)
    .filter((c): c is ClawHubCard => c !== null);
}

/** 技能详情(重名 slug 缺 ownerHandle = 409,ClawHubHttpError 原样抛)。 */
export async function getClawHubSkillDetail(
  slug: string,
  ownerHandle?: string,
): Promise<ClawHubDetail> {
  const url = new URL(`/api/v1/skills/${encodeURIComponent(slug)}`, "https://clawhub.ai");
  if (ownerHandle) url.searchParams.set("ownerHandle", ownerHandle);
  const payload = clawhubJsonRecord(await clawhubJson(url.toString()));
  const item = clawhubJsonRecord(payload.skill);
  const card = normalizeClawHubCard({ ...item, ownerHandle: item.ownerHandle ?? ownerHandle });
  if (!card) throw new Error(`ClawHub skill not found: ${slug}`);
  const latestVersion = clawhubJsonRecord(item.latestVersion);
  const owner = clawhubJsonRecord(item.owner);
  return {
    ...card,
    license:
      typeof latestVersion.license === "string"
        ? latestVersion.license
        : typeof item.license === "string"
          ? item.license
          : "",
    changelog: typeof latestVersion.changelog === "string" ? latestVersion.changelog : "",
    ownerDisplayName: typeof owner.displayName === "string" ? owner.displayName : card.ownerHandle,
  };
}

/** 重名 slug 消歧报错(列出候选,不盲选)。 */
export class ClawHubAmbiguousOwnerError extends Error {
  readonly candidates: readonly ClawHubCard[];

  constructor(slug: string, candidates: readonly ClawHubCard[]) {
    super(
      `ClawHub skill "${slug}" has multiple publishers: ${candidates
        .map((c) => c.ownerHandle)
        .join(", ")}`,
    );
    this.name = "ClawHubAmbiguousOwnerError";
    this.candidates = candidates;
  }
}

/**
 * owner 消歧编排:卡带 ownerHandle 直接用;缺失时以 slug 精确搜索(limit 50)
 * 取候选按 updatedAt → latestVersion → downloads 收敛(提案 §4.4)。
 * 无候选/仍歧义 = 抛错列候选。
 */
export async function resolveClawHubOwner(card: ClawHubCard): Promise<ClawHubCard> {
  if (card.ownerHandle) return card;
  const candidates = await searchClawHubSkills({ query: card.slug, limit: 50 });
  const resolved = selectOwnerCandidate(card, candidates);
  if (!resolved) {
    throw new ClawHubAmbiguousOwnerError(
      card.slug,
      candidates.filter((c) => c.slug.toLowerCase() === card.slug.toLowerCase() && c.ownerHandle),
    );
  }
  return {
    ...card,
    ownerHandle: resolved.ownerHandle,
    webUrl: resolved.webUrl || buildClawHubWebUrl(resolved.ownerHandle, card.slug),
    downloadUrl: buildClawHubDownloadUrl(card.slug, resolved.ownerHandle),
  };
}

function clawhubJsonRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
