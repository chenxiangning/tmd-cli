/**
 * 覆盖层容量逐出 —— sessionPins/sessionArchive/sessionDeleted 写入路径共用。
 * 满额(> max)时按时间戳逐出「新写入 key 之外」的最旧条目;条目仅时间戳,
 * 逐出零数据损失。sanitize 侧是按 key 序防御性截断(不同算法,不在此)。
 */

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
