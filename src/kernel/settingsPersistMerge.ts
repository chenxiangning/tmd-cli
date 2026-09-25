/**
 * 设置双实例合并层 —— persist 标记域的拉盘合并与盘上基线(规模铁则拆分)。
 *
 * 双实例丢更新防护(2026-09-11 实证):dev 版与打包版可能并存,共享
 * settings.json。persist 前拉盘上最新做记录层合并:标记类字段按 key 并集
 * (带 ts 时较新者胜),标量仍以本实例为准;删除意图靠 diskBaseline 判别。
 * 合并只作用于上送 payload,不回写内存态 —— 他窗标记不实时串进本窗,重载生效。
 */

import { sanitize } from "./settingsSanitize";
import type { AppSettings } from "./settingsTypes";

type RecordLike = Record<string, Record<string, unknown>>;

/** 带 ts 的记录字段:同 key 冲突取时间戳较新者。 */
const MERGE_TS_FIELDS = {
  sessionArchive: "archivedAt",
  sessionDeleted: "deletedAt",
  sessionKeep: "keptAt",
  sessionPins: "pinnedAt",
  engineVersionFavs: "favedAt",
} as const;

/** 无 ts 的记录字段:并集,本实例值优先。 */
const MERGE_PLAIN_FIELDS = [
  "sessionTitles",
  "workspaceCollapsedMap",
  "workspaceGroupCollapsedMap",
  "localPluginTrust",
] as const;

/** 键序无关的等值比较(合并后 JSON 键序会漂移,不能拿 stringify 判「未改动」)。 */
function deepEqualStable(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(
    (k) => k in (b as object) && deepEqualStable((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

/** 盘上基线:最后一次写盘时本实例真实有过(内存或旧基线)的盘像;null = boot 前
 *  或从未见过盘。他实例新增被吸收落盘但不入基线(见 advanceBaseline)。 */
let diskBaseline: AppSettings | null = null;

export function setDiskBaseline(value: AppSettings | null): void {
  diskBaseline = value;
}

/** per-key 合并:盘上条目除「本地已删」外全收,本实例 key 覆盖(带 ts 时较新者胜)。 */
function mergeEntries(
  memory: RecordLike,
  disk: RecordLike,
  tsField: string | null,
  base: RecordLike | null,
): RecordLike {
  const out: RecordLike = { ...disk };
  /* 内存没有而盘上有的 key:基线里已有且自基线后未被外实例改动 → 本地删除,
     删除意图赢(否则取消置顶/归档永不落盘,重启复活);基线里没有 → 外实例
     新增,照收(双实例丢更新防护不变)。 */
  if (base)
    for (const key of Object.keys(out)) {
      if (key in memory) continue;
      const mine = base[key];
      if (mine === undefined) continue;
      const gone =
        tsField === null
          ? deepEqualStable(out[key], mine)
          : (typeof out[key][tsField] === "number" ? (out[key][tsField] as number) : -1) <=
            (typeof mine[tsField] === "number" ? (mine[tsField] as number) : -1);
      if (gone) delete out[key];
    }
  for (const key of Object.keys(memory)) {
    const theirs = out[key];
    if (theirs === undefined || tsField === null) {
      out[key] = memory[key];
      continue;
    }
    const a = typeof memory[key][tsField] === "number" ? (memory[key][tsField] as number) : -1;
    const b = typeof theirs[tsField] === "number" ? (theirs[tsField] as number) : -1;
    if (a >= b) out[key] = memory[key];
  }
  return out;
}

/** 拉盘合并:标记域(带 ts/无 ts 两族)逐域 mergeEntries,其余域保持内存值。 */
export function mergeDiskIntoPayload(memory: AppSettings, raw: unknown): AppSettings {
  const disk = sanitize(raw);
  const base = diskBaseline;
  const out = { ...memory } as unknown as Record<string, unknown>;
  for (const [field, tsField] of Object.entries(MERGE_TS_FIELDS)) {
    out[field] = mergeEntries(
      memory[field as keyof AppSettings] as unknown as RecordLike,
      disk[field as keyof AppSettings] as unknown as RecordLike,
      tsField,
      base ? (base[field as keyof AppSettings] as unknown as RecordLike) : null,
    );
  }
  for (const field of MERGE_PLAIN_FIELDS) {
    out[field] = mergeEntries(
      memory[field] as unknown as RecordLike,
      disk[field] as unknown as RecordLike,
      null,
      base ? (base[field as keyof AppSettings] as unknown as RecordLike) : null,
    );
  }
  return out as unknown as AppSettings;
}

/** 基线推进:内存有过的 key 取 payload 值;旧基线有而内存没有的(被他实例改动
 *  后存活下来的)保留旧戳——若随 payload 新值入基线,下一次 persist 会拿它跟盘
 *  上同一新值比出「未改动」误判本地删除(双实例丢更新回归,2026-09-13 review
 *  实证)。他实例新增(两处都没有)不入基线,落盘照旧、下轮继续照收。 */
export function advanceBaseline(memory: AppSettings, payload: AppSettings): void {
  const next = { ...payload } as unknown as Record<string, unknown>;
  for (const field of [...Object.keys(MERGE_TS_FIELDS), ...MERGE_PLAIN_FIELDS]) {
    const mem = memory[field as keyof AppSettings] as unknown as RecordLike;
    const old = diskBaseline
      ? (diskBaseline[field as keyof AppSettings] as unknown as RecordLike)
      : null;
    const merged = next[field] as RecordLike;
    const proj: RecordLike = {};
    for (const key of Object.keys(merged)) {
      if (key in mem) proj[key] = merged[key];
      else if (old !== null && key in old) proj[key] = old[key];
    }
    next[field] = proj;
  }
  diskBaseline = next as unknown as AppSettings;
}
