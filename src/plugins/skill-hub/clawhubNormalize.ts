/**
 * ClawHub 卡片归一化 + owner 消歧(纯函数,单测 seam)。
 *
 * 契约来源:提案 2026-09-28-skill-hub-plugin §4.4 + 2026-09-28 clawhub.ai
 * 实测响应形态(列表项 flat + stats{} 双形态;搜索项 flat downloads、无
 * latestVersion/topics)。缺失值一律收敛为空串/0/空数组。
 */

export interface ClawHubCard {
  slug: string;
  displayName: string;
  summary: string;
  /** 展示用前 3 个主题。 */
  topics: string[];
  latestVersion: string;
  downloads: number;
  stars: number;
  installsCurrent: number;
  updatedAt: number;
  ownerHandle: string;
  webUrl: string;
  downloadUrl: string;
}

export interface ClawHubDetail extends ClawHubCard {
  license: string;
  changelog: string;
  ownerDisplayName: string;
}

export const CLAWHUB_SORTS = ["downloads", "stars", "installs", "updated", "newest"] as const;
export type ClawHubSort = (typeof CLAWHUB_SORTS)[number];

export const CLAWHUB_API_BASE = "https://clawhub.ai";

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string" && v.trim() !== "")
    : [];
}

export function buildClawHubWebUrl(ownerHandle: string, slug: string): string {
  if (!ownerHandle) return "";
  return `${CLAWHUB_API_BASE}/${encodeURIComponent(ownerHandle)}/skills/${encodeURIComponent(slug)}`;
}

export function buildClawHubDownloadUrl(slug: string, ownerHandle?: string): string {
  const url = new URL("/api/v1/download", CLAWHUB_API_BASE);
  url.searchParams.set("slug", slug);
  url.searchParams.set("tag", "latest");
  if (ownerHandle) url.searchParams.set("ownerHandle", ownerHandle);
  return url.toString();
}

/** 归一化列表/搜索卡:slug 缺失或含白名单外字符 = 丢弃(null);缺失统计值收敛 0/空串。
 *  slug 白名单(首字符字母数字,余 [A-Za-z0-9._-]):slug 直接拼安装目录与下载
 *  URL(install.ts runInstall / buildClawHubDownloadUrl),注册表被污染时挡住
 *  `..`/`/` 路径逃逸与 URL 注入;`.`/`..` 自身被首字符规则一并排除。 */
export function normalizeClawHubCard(raw: unknown): ClawHubCard | null {
  const item = asRecord(raw);
  const slug = asString(item.slug);
  if (!slug || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(slug)) return null;
  const stats = asRecord(item.stats);
  const latestVersion = asRecord(item.latestVersion);
  const tags = asRecord(item.tags);
  const ownerHandle = asString(item.ownerHandle);
  return {
    slug,
    displayName: asString(item.displayName) || slug,
    summary: asString(item.summary),
    topics: asStringArray(item.topics).slice(0, 3),
    latestVersion:
      asString(latestVersion.version) || asString(tags.latest) || asString(item.version),
    downloads: asNumber(item.downloads) || asNumber(stats.downloads),
    stars: asNumber(item.stars) || asNumber(stats.stars),
    installsCurrent:
      asNumber(item.installsCurrent) ||
      asNumber(item.installs) ||
      asNumber(stats.installsCurrent) ||
      asNumber(stats.installs),
    updatedAt: asNumber(item.updatedAt),
    ownerHandle,
    webUrl: asString(item.webUrl) || buildClawHubWebUrl(ownerHandle, slug),
    downloadUrl: asString(item.downloadUrl) || buildClawHubDownloadUrl(slug, ownerHandle || undefined),
  };
}

/**
 * owner 消歧候选收敛(提案 §4.4):slug 精确匹配且带 owner 的候选,按
 * updatedAt → latestVersion → downloads 逐级收敛至唯一;收敛后仍多个 =
 * null(调用方报错列候选,不盲选)。无同 slug 候选 = null。
 */
export function selectOwnerCandidate(
  card: Pick<ClawHubCard, "slug" | "updatedAt" | "latestVersion" | "downloads">,
  candidates: readonly ClawHubCard[],
): ClawHubCard | null {
  let exact = candidates.filter(
    (c) => c.slug.toLowerCase() === card.slug.toLowerCase() && c.ownerHandle,
  );
  if (exact.length <= 1) return exact[0] ?? null;
  const narrow = (predicate: (c: ClawHubCard) => boolean): void => {
    const next = exact.filter(predicate);
    if (next.length > 0) exact = next;
  };
  if (card.updatedAt > 0) narrow((c) => c.updatedAt === card.updatedAt);
  if (exact.length === 1) return exact[0];
  if (card.latestVersion) narrow((c) => c.latestVersion === card.latestVersion);
  if (exact.length === 1) return exact[0];
  if (card.downloads > 0) narrow((c) => c.downloads === card.downloads);
  return exact.length === 1 ? exact[0] : null;
}
