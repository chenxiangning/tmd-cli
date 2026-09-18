/**
 * 会话五层覆盖域清洗 —— 命名/置顶/归档/删除意图/保留标记(自 settingsSanitize.ts 拆出,300 行铁则)。
 * 先例:sshSettings.ts 域文件。装配仍在 settingsSanitize.ts 的 sanitize()。
 */

import type {
  SessionArchiveEntry,
  SessionDeletedEntry,
  SessionKeepEntry,
  SessionPinEntry,
  SessionPinScope,
} from "./settingsTypes";

/** 手动命名覆盖层上限:500 条(超出按 key 序丢弃,确定性兜底);标题 1–200 字符。 */
const SESSION_TITLES_MAX_ENTRIES = 500;
const SESSION_TITLE_MAX_LENGTH = 200;

/** 会话命名清洗:只收非空 key + 非空字符串值,截断超长标题,按 key 序限量纳入。 */
export function sanitizeSessionTitles(raw: unknown): Record<string, string> {
  const titles: Record<string, string> = {};
  if (!raw || typeof raw !== "object") return titles;
  const entries = raw as Record<string, unknown>;
  for (const key of Object.keys(entries).sort()) {
    if (Object.keys(titles).length >= SESSION_TITLES_MAX_ENTRIES) break;
    const value = entries[key];
    if (!key || typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    titles[key] = trimmed.slice(0, SESSION_TITLE_MAX_LENGTH);
  }
  return titles;
}
/** 置顶层上限:200 条(超出按 key 序丢弃,确定性兜底);标题快照 ≤200 字符(可为空串)。 */
const SESSION_PINS_MAX_ENTRIES = 200;
/** 归档层上限:2000(须与 sessionArchive.SESSION_ARCHIVE_MAX 同步;自动归档
 * 写入密度高,200 约 10 天触顶逐出,违背归档标记持久语义)。 */
const SESSION_ARCHIVE_MAX_ENTRIES = 2000;
const SESSION_PIN_SCOPES: readonly SessionPinScope[] = ["global", "workspace"];

/** 置顶清洗:只收合法 scope + 有限非负时间戳的项,标题截断,按 key 序限量纳入。 */
export function sanitizeSessionPins(raw: unknown): Record<string, SessionPinEntry> {
  const pins: Record<string, SessionPinEntry> = {};
  if (!raw || typeof raw !== "object") return pins;
  const entries = raw as Record<string, unknown>;
  for (const key of Object.keys(entries).sort()) {
    if (Object.keys(pins).length >= SESSION_PINS_MAX_ENTRIES) break;
    const value = entries[key];
    if (!key || !value || typeof value !== "object") continue;
    const entry = value as Record<string, unknown>;
    if (!SESSION_PIN_SCOPES.includes(entry.scope as SessionPinScope)) continue;
    const pinnedAt = typeof entry.pinnedAt === "number" ? entry.pinnedAt : Number.NaN;
    if (!Number.isFinite(pinnedAt) || pinnedAt < 0) continue;
    pins[key] = {
      scope: entry.scope as SessionPinScope,
      pinnedAt: Math.floor(pinnedAt),
      title:
        typeof entry.title === "string"
          ? entry.title.trim().slice(0, SESSION_TITLE_MAX_LENGTH)
          : "",
    };
  }
  return pins;
}

/**
 * 归档层清洗:只收有限非负时间戳的项,按 key 序限量纳入(与置顶同款确定性兜底)。
 */
export function sanitizeSessionArchive(raw: unknown): Record<string, SessionArchiveEntry> {
  const archive: Record<string, SessionArchiveEntry> = {};
  if (!raw || typeof raw !== "object") return archive;
  const entries = raw as Record<string, unknown>;
  for (const key of Object.keys(entries).sort()) {
    if (Object.keys(archive).length >= SESSION_ARCHIVE_MAX_ENTRIES) break;
    const value = entries[key];
    if (!key || !value || typeof value !== "object") continue;
    const entry = value as Record<string, unknown>;
    const archivedAt = typeof entry.archivedAt === "number" ? entry.archivedAt : Number.NaN;
    if (!Number.isFinite(archivedAt) || archivedAt < 0) continue;
    archive[key] = { archivedAt: Math.floor(archivedAt) };
  }
  return archive;
}

/**
 * 删除意图层清洗:只收有限非负时间戳的项,按 key 序限量纳入(与归档同款确定性兜底)。
 */
export function sanitizeSessionDeleted(raw: unknown): Record<string, SessionDeletedEntry> {
  const deleted: Record<string, SessionDeletedEntry> = {};
  if (!raw || typeof raw !== "object") return deleted;
  const entries = raw as Record<string, unknown>;
  for (const key of Object.keys(entries).sort()) {
    if (Object.keys(deleted).length >= SESSION_PINS_MAX_ENTRIES) break;
    const value = entries[key];
    if (!key || !value || typeof value !== "object") continue;
    const entry = value as Record<string, unknown>;
    const deletedAt = typeof entry.deletedAt === "number" ? entry.deletedAt : Number.NaN;
    if (!Number.isFinite(deletedAt) || deletedAt < 0) continue;
    deleted[key] = { deletedAt: Math.floor(deletedAt) };
  }
  return deleted;
}

/**
 * 保留标记层清洗:只收有限非负时间戳的项,按 key 序限量纳入(与归档/删除同款确定性兜底)。
 * 上限与 overlayEvict 缺省容量(200)同,沿用 SESSION_PINS_MAX_ENTRIES。
 */
export function sanitizeSessionKeep(raw: unknown): Record<string, SessionKeepEntry> {
  const keep: Record<string, SessionKeepEntry> = {};
  if (!raw || typeof raw !== "object") return keep;
  const entries = raw as Record<string, unknown>;
  for (const key of Object.keys(entries).sort()) {
    if (Object.keys(keep).length >= SESSION_PINS_MAX_ENTRIES) break;
    const value = entries[key];
    if (!key || !value || typeof value !== "object") continue;
    const entry = value as Record<string, unknown>;
    const keptAt = typeof entry.keptAt === "number" ? entry.keptAt : Number.NaN;
    if (!Number.isFinite(keptAt) || keptAt < 0) continue;
    keep[key] = { keptAt: Math.floor(keptAt) };
  }
  return keep;
}

/** 引擎版本收藏层上限:100 条(与置顶同款确定性兜底口径)。 */
const ENGINE_VERSION_FAVS_MAX_ENTRIES = 100;
/** key 形状:`${engineId}@${x.y.z}`(与 welcome 插件 versionFavKey 同构)。 */
const ENGINE_VERSION_FAV_KEY = /^[^\s@]+@\d+\.\d+\.\d+$/;

/** 引擎版本收藏清洗:key 须为 engineId@semver,只收有限非负 favedAt,按 key 序限量纳入。 */
export function sanitizeEngineVersionFavs(raw: unknown): Record<string, { favedAt: number }> {
  const favs: Record<string, { favedAt: number }> = {};
  if (!raw || typeof raw !== "object") return favs;
  const entries = raw as Record<string, unknown>;
  for (const key of Object.keys(entries).sort()) {
    if (Object.keys(favs).length >= ENGINE_VERSION_FAVS_MAX_ENTRIES) break;
    const value = entries[key];
    if (!ENGINE_VERSION_FAV_KEY.test(key) || !value || typeof value !== "object") continue;
    const entry = value as Record<string, unknown>;
    const favedAt = typeof entry.favedAt === "number" ? entry.favedAt : Number.NaN;
    if (!Number.isFinite(favedAt) || favedAt < 0) continue;
    favs[key] = { favedAt: Math.floor(favedAt) };
  }
  return favs;
}
