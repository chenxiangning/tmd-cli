/**
 * 引擎版本收藏层 —— settings.engineVersionFavs 的领域 API(welcome 插件编辑域)。
 * key = `${engineId}@${version}`(扁平复合 key,与 sessionPins 三段身份同惯例);
 * 双实例合并由 kernel settings 的 MERGE_TS_FIELDS(favedAt)兜底,本层只读写。
 */
import { getSettingsState, updateSettings } from "@kernel/settings";
import { compareSemver } from "./latestVersion";

/** 收藏 key:`${engineId}@${version}`(清洗白名单同构,见 settingsSanitizeSessions)。 */
export function versionFavKey(engineId: string, version: string): string {
  return `${engineId}@${version}`;
}

/** 某引擎的收藏版本列表(semver 降序)。 */
export function listVersionFavs(
  favs: Record<string, { favedAt: number }>,
  engineId: string,
): string[] {
  const prefix = `${engineId}@`;
  return Object.keys(favs)
    .filter((k) => k.startsWith(prefix))
    .map((k) => k.slice(prefix.length))
    .sort((a, b) => compareSemver(b, a));
}

/** 切换收藏;已收藏 = 取消。 */
export function toggleVersionFav(engineId: string, version: string): void {
  const current = getSettingsState().settings.engineVersionFavs;
  const key = versionFavKey(engineId, version);
  const next = { ...current };
  if (key in next) delete next[key];
  else next[key] = { favedAt: Date.now() };
  updateSettings({ engineVersionFavs: next });
}
