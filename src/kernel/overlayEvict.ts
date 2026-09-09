/**
 * 覆盖层容量逐出 —— sessionPins/sessionArchive/sessionDeleted 写入路径共用。
 * 满额(> max)时按时间戳逐出「新写入 key 之外」的最旧条目;条目仅时间戳,
 * 逐出零数据损失。sanitize 侧是按 key 序防御性截断(不同算法,不在此)。
 * 另收:三层共用 key 助手(sessionOverlayKey)与单字段时间戳覆盖层工厂
 * (makeOverlay)—— sessionArchive/sessionDeleted 近同构的落点。
 */

import { getSettingsState, updateSettings } from "./settings";

/** 覆盖层 key:`${workspaceId}:${profileId}:${cliSessionId}` —— 三段身份缺一不可;
 *  置顶/归档/删除意图三层共用(未落盘的活会话无稳定身份,不进覆盖层)。 */
export function sessionOverlayKey(
  workspaceId: string,
  profileId: string,
  cliSessionId: string,
): string {
  return `${workspaceId}:${profileId}:${cliSessionId}`;
}

/** 覆盖层容量:置顶/归档/删除同款 200 条上限。 */
const OVERLAY_MAX_ENTRIES = 200;

type OverlaySettingsKey = "sessionArchive" | "sessionDeleted";

/**
 * 单字段时间戳覆盖层工厂(sessionArchive/sessionDeleted 同构:is/mark/unmark + 容量逐出)。
 * mark 幂等(已标记刷新时间戳);满额逐出 tsField 最旧条目 —— 条目仅时间戳,逐出零数据
 * 损失;曾用「满额拒绝新 key」,200 条封顶后每次写入静默无效(2026-09-07 实测踩坑)。
 * settings 表按 union key 取出后类型不可并,工厂内一次性擦除(as unknown as),
 * 调用方以具体 Entry 泛型实例化后即类型安全。
 */
export function makeOverlay<E>(settingsKey: OverlaySettingsKey, tsField: keyof E) {
  const table = () =>
    getSettingsState().settings[settingsKey] as unknown as Record<string, E>;
  const save = (next: Record<string, E>) =>
    updateSettings({ [settingsKey]: next } as unknown as Parameters<typeof updateSettings>[0]);
  return {
    /** 是否已标记。 */
    has(key: string): boolean {
      return table()[key] !== undefined;
    },
    /** 标记;已标记刷新时间戳(幂等);满额逐出 tsField 最旧的条目。 */
    mark(key: string): void {
      const current = table();
      const next = { ...current, [key]: { [tsField]: Date.now() } as E };
      evictOldest(next, current, key, (e) => (e as unknown as Record<string, number>)[tsField as string], OVERLAY_MAX_ENTRIES);
      save(next);
    },
    /** 取消标记;未标记为 no-op。 */
    unmark(key: string): void {
      const current = table();
      if (!(key in current)) return;
      const next = { ...current };
      delete next[key];
      save(next);
    },
  };
}

/** 就地修改 next:超上限时逐出 current 里(排除 newKey)tsOf 最旧的条目。 */
export function evictOldest<T>(
  next: Record<string, T>,
  current: Record<string, T>,
  newKey: string,
  tsOf: (value: T) => number,
  max: number,
): void {
  if (Object.keys(next).length <= max) return;
  let oldest: string | undefined;
  for (const k of Object.keys(current)) {
    if (k !== newKey && (oldest === undefined || tsOf(current[k]) < tsOf(current[oldest]))) {
      oldest = k;
    }
  }
  if (oldest !== undefined) delete next[oldest];
}
