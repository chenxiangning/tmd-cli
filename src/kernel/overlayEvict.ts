/**
 * 覆盖层容量逐出 —— sessionPins/sessionArchive/sessionDeleted/sessionKeep 写入路径共用。
 * 满额(> max)时按时间戳逐出「新写入 key 之外」的最旧条目;条目仅时间戳,
 * 逐出零数据损失。sanitize 侧是按 key 序防御性截断(不同算法,不在此)。
 * 另收:各层共用 key 助手(sessionOverlayKey)与单字段时间戳覆盖层工厂
 * (makeOverlay)—— sessionArchive/sessionDeleted/sessionKeep 同构的落点。
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

/** 覆盖层默认容量;sessionArchive 自动归档写入密度高,实例化处单独提容。 */
const OVERLAY_MAX_ENTRIES = 200;

type OverlaySettingsKey = "sessionArchive" | "sessionDeleted" | "sessionKeep";

/**
 * 单字段时间戳覆盖层工厂(sessionArchive/sessionDeleted/sessionKeep 同构:
 * is/mark/markMany/unmark + 容量逐出)。
 * mark 幂等(已标记刷新时间戳);满额逐出 tsField 最旧条目 —— 条目仅时间戳,逐出零数据
 * 损失;曾用「满额拒绝新 key」,200 条封顶后每次写入静默无效(2026-09-07 实测踩坑)。
 * markMany 是清扫批量入口:整表合并 + 逐出后单次 updateSettings 写盘 ——
 * 逐条 mark 会给 settings persist 串行链打 N 轮读盘→合并→写盘(200 条 = 200 轮)。
 * settings 表按 union key 取出后类型不可并,工厂内一次性擦除(as unknown as),
 * 调用方以具体 Entry 泛型实例化后即类型安全。
 */
export function makeOverlay<E>(settingsKey: OverlaySettingsKey, tsField: keyof E, max = OVERLAY_MAX_ENTRIES) {
  const table = () =>
    getSettingsState().settings[settingsKey] as unknown as Record<string, E>;
  const save = (next: Record<string, E>) =>
    updateSettings({ [settingsKey]: next } as unknown as Parameters<typeof updateSettings>[0]);
  /** mark/markMany 不依赖 this:领域 API 以 `export const x = overlay.mark` 解绑导出。 */
  const markMany = (keys: readonly string[]): void => {
    if (keys.length === 0) return;
    const current = table();
    const now = Date.now();
    const next = { ...current };
    for (const key of keys) next[key] = { [tsField]: now } as E;
    evictOldestBulk(next, new Set(keys), (e) => (e as unknown as Record<string, number>)[tsField as string], max);
    save(next);
  };
  return {
    /** 是否已标记。 */
    has(key: string): boolean {
      return table()[key] !== undefined;
    },
    /** 标记;已标记刷新时间戳(幂等);满额逐出 tsField 最旧的条目。 */
    mark(key: string): void {
      markMany([key]);
    },
    /** 批量标记(幂等同上);整表合并 + 逐出后单次写盘。空数组 no-op。 */
    markMany,
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

/** 就地修改 next:超上限时循环逐出「排除新写 key 集」中 tsOf 最旧的条目,直到不超限。 */
function evictOldestBulk<T>(
  next: Record<string, T>,
  protectedKeys: ReadonlySet<string>,
  tsOf: (value: T) => number,
  max: number,
): void {
  while (Object.keys(next).length > max) {
    let oldest: string | undefined;
    for (const k of Object.keys(next)) {
      if (protectedKeys.has(k)) continue;
      if (oldest === undefined || tsOf(next[k]) < tsOf(next[oldest])) oldest = k;
    }
    if (oldest === undefined) return; /* 全是新写 key:保留新写,超限由 sanitize 兜底 */
    delete next[oldest];
  }
}
