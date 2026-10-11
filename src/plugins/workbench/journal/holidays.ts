/**
 * 节假日关联 —— 联网拉取 NateScarlet/holiday-cn(国务院办公厅放假安排,含调休;
 * raw.githubusercontent,经 ipc.quotaFetch 复用网络代理)。成功缓存全年
 * daily/holidays/YYYY.json;失败用缓存;无缓存离线保底(仅周末底纹)。
 * 状态如实呈现:online(今年已联网)/ cached(用缓存)/ offline。
 */
import { createSubscribable } from "@kernel/subscribable";
import { ipc } from "@kernel/ipc";
import { dailyPaths, readJson, writeJson } from "./journalFiles";
import { ensureDir } from "@kernel/fsDirs";

interface HolDay {
  name: string;
  /** true = 放假;false = 调休上班(不入休标记)。 */
  off: boolean;
}

interface HolidaysYearFile {
  year: number;
  fetchedAt: number;
  days: Record<string, HolDay>;
}

export type HolidayStatus = "init" | "online" | "cached" | "offline";

interface HolidaysState {
  status: HolidayStatus;
  /** 年 → 日表(key MM-DD)。 */
  byYear: Record<number, Record<string, HolDay>>;
}

const store = createSubscribable<HolidaysState>({ status: "init", byYear: {} });
const fetching = new Set<number>();
/** 拉取新鲜度窗:24h 内不重复联网(每日增量拉取语义)。 */
const FRESH_MS = 24 * 3600_000;

export function useHolidays(): HolidaysState {
  return store.useStore();
}

/** 某日节假日(放假日);无数据/调休上班日/离线返回 null。 */
export function holOf(y: number, m: number, d: number): string | null {
  if (!getEnabled()) return null;
  const days = store.snapshot.byYear[y];
  const hit = days?.[`${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`];
  return hit?.off ? hit.name : null;
}

/** 某日是否调休上班日(off:false 条目此前被 holOf 丢弃,周末底纹无从豁免);
 *  无数据/离线返回 false(宁画周末纹,不误判上班日)。 */
export function isWorkdayOverride(y: number, m: number, d: number): boolean {
  if (!getEnabled()) return false;
  const days = store.snapshot.byYear[y];
  const hit = days?.[`${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`];
  return hit != null && !hit.off;
}

/** 启用开关注入(避免 holidays → journalStore → taskQueue 循环依赖;config 读取走注入口)。 */
let enabledFn: () => boolean = () => true;
export function bindHolidayEnabled(fn: () => boolean): void {
  enabledFn = fn;
}
const getEnabled = (): boolean => enabledFn();

/** API 响应 → 年文件(纯函数,测试面;异形数据宽容:坏条目跳过)。 */
export function parseHolidayPayload(year: number, fetchedAt: number, payload: unknown): HolidaysYearFile | null {
  const days: Record<string, HolDay> = {};
  const list = (payload as { days?: unknown })?.days;
  if (!Array.isArray(list)) return null;
  for (const raw of list) {
    const e = raw as { name?: unknown; date?: unknown; isOffDay?: unknown };
    if (typeof e.name !== "string" || typeof e.date !== "string" || typeof e.isOffDay !== "boolean") continue;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(e.date);
    if (!m || Number(m[1]) !== year) continue;
    days[`${m[2]}-${m[3]}`] = { name: e.name, off: e.isOffDay };
  }
  return Object.keys(days).length ? { year, fetchedAt, days } : null;
}

/** 确保某年数据在位:内存 → (24h 内)磁盘 → 联网;联网失败回落磁盘缓存。
 *  全函数兜底 catch:configDir 不可用(桩/无 Tauri)等异常吞成静默离线,绝不
 *  reject(调用点全是 `void ensureHolidays(...)`,reject 即 unhandled)。 */
export async function ensureHolidays(year: number, force = false): Promise<void> {
  try {
    if (!getEnabled()) {
      store.commit({ ...store.snapshot, status: "offline", byYear: {} });
      return;
    }
    const paths = await dailyPaths();
    const file = `${paths.root}/holidays/${year}.json`;
    if (!store.snapshot.byYear[year]) {
      const cached = await readJson<HolidaysYearFile | null>(file, null);
      if (cached?.days) {
        const byYear = { ...store.snapshot.byYear, [year]: cached.days };
        store.commit({ ...store.snapshot, byYear, status: store.snapshot.status === "online" ? "online" : "cached" });
        if (!force && Date.now() - cached.fetchedAt < FRESH_MS) return;
      }
    } else if (!force && store.snapshot.byYear[year] && store.snapshot.status === "online") {
      return; /* 已联网且未要求强制 */
    }
    if (fetching.has(year)) return;
    fetching.add(year);
    try {
      /* quotaFetch 对 JSON 内容类型已代解析(res.body 即对象);非 200/异形回落缓存。 */
      const res = await ipc.quotaFetch({ url: `https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/${year}.json`, method: "GET" });
      const parsed = res.status === 200 ? parseHolidayPayload(year, Date.now(), res.body) : null;
      if (parsed) {
        await ensureDir(`${paths.root}/holidays`).catch(() => undefined);
        await writeJson(file, parsed).catch(() => undefined);
        const byYear = { ...store.snapshot.byYear, [year]: parsed.days };
        store.commit({ ...store.snapshot, byYear, status: "online" });
        return;
      }
      if (!store.snapshot.byYear[year]) {
        store.commit({ ...store.snapshot, status: "offline" });
      }
    } catch {
      if (!store.snapshot.byYear[year]) store.commit({ ...store.snapshot, status: "offline" });
    } finally {
      fetching.delete(year);
    }
  } catch {
    /* 走到这说明连磁盘/配置层都不可用:维持现状(离线保底),不打断调用方。 */
  }
}
