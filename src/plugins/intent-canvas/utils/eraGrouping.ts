import type { IntentCanvasIndexEntry } from "../types";

export const STALE_ERA_THRESHOLD_DAYS = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

export type CanvasEraKind = "week" | "month" | "stale";

export type CanvasEra = {
  id: string;
  kind: CanvasEraKind;
  /** 仅 month 组使用：月份（1-12）与年份（用于跨年标签）。 */
  month?: number;
  year?: number;
  entries: IntentCanvasIndexEntry[];
  canvasCount: number;
  elementSum: number;
  /** 组内最大陈旧天数（仅 stale 组有语义）。 */
  maxStaleDays: number;
};

function startOfCurrentWeek(now: Date): Date {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // 周一起算：getDay() 周日为 0，偏移到周一。
  const offset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - offset);
  return start;
}

function staleDays(updatedAt: string, now: Date): number {
  const time = new Date(updatedAt).getTime();
  if (!Number.isFinite(time)) {
    return 0;
  }
  return Math.max(0, Math.floor((now.getTime() - time) / DAY_MS));
}

function toMonthKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}`;
}

/**
 * 将 index entries 按 updatedAt 分 era 桶：本周 / 各自然月 / 更早（≥阈值天数未更新）。
 * 输入要求已按 updatedAt 倒序（loadIntentCanvasIndex 保证）；空组不产出。
 */
export function groupCanvasEntriesByEra(
  entries: IntentCanvasIndexEntry[],
  now: Date,
): CanvasEra[] {
  const weekStart = startOfCurrentWeek(now).getTime();
  const staleThresholdMs = STALE_ERA_THRESHOLD_DAYS * DAY_MS;

  const weekEntries: IntentCanvasIndexEntry[] = [];
  const staleEntries: IntentCanvasIndexEntry[] = [];
  const monthBuckets = new Map<string, IntentCanvasIndexEntry[]>();

  entries.forEach((entry) => {
    const updatedTime = new Date(entry.updatedAt).getTime();
    if (!Number.isFinite(updatedTime)) {
      staleEntries.push(entry);
      return;
    }
    if (now.getTime() - updatedTime >= staleThresholdMs) {
      staleEntries.push(entry);
      return;
    }
    if (updatedTime >= weekStart) {
      weekEntries.push(entry);
      return;
    }
    const key = toMonthKey(new Date(updatedTime));
    const bucket = monthBuckets.get(key);
    if (bucket) {
      bucket.push(entry);
    } else {
      monthBuckets.set(key, [entry]);
    }
  });

  const eras: CanvasEra[] = [];

  if (weekEntries.length > 0) {
    eras.push({
      id: "week",
      kind: "week",
      entries: weekEntries,
      canvasCount: weekEntries.length,
      elementSum: weekEntries.reduce((sum, entry) => sum + entry.elementCount, 0),
      maxStaleDays: 0,
    });
  }

  // entries 已按 updatedAt 倒序，month bucket 的首次出现顺序即月份倒序。
  monthBuckets.forEach((bucketEntries, key) => {
    const firstDate = new Date(bucketEntries[0].updatedAt);
    eras.push({
      id: `month-${key}`,
      kind: "month",
      month: firstDate.getMonth() + 1,
      year: firstDate.getFullYear(),
      entries: bucketEntries,
      canvasCount: bucketEntries.length,
      elementSum: bucketEntries.reduce((sum, entry) => sum + entry.elementCount, 0),
      maxStaleDays: 0,
    });
  });

  if (staleEntries.length > 0) {
    eras.push({
      id: "stale",
      kind: "stale",
      entries: staleEntries,
      canvasCount: staleEntries.length,
      elementSum: staleEntries.reduce((sum, entry) => sum + entry.elementCount, 0),
      maxStaleDays: staleEntries.reduce(
        (max, entry) => Math.max(max, staleDays(entry.updatedAt, now)),
        0,
      ),
    });
  }

  return eras;
}
