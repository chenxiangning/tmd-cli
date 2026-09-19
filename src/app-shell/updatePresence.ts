/**
 * 更新发现的后台化 —— 启动节流检查 + 底栏「有新版」提示的数据源。
 *
 * 契约(spec 2026-09-19 增补):
 * - atom 通道(checkLatestRelease)从「仅弹窗手动触发」扩展为「后台节流触发」:
 *   距上次成功检查 ≥6h 才发请求(localStorage 记账),启动时查一次,
 *   长驻会话每 6h 周期兜底;
 * - 检查结果连同 checkedAt 落 localStorage:重启先亮缓存结论,过期才重查;
 * - 失败不记账:下次启动 / 下个周期自动重试;
 * - 只负责「发现」,绝不触碰 autoUpdate —— 下载与安装仍由版本弹窗按钮,
 *   用户手点(不自动更新)。
 */

import { createSubscribable } from "@kernel/subscribable";
import { checkLatestRelease, type ReleaseInfo } from "./updateCheck";

/** 检查节流间隔:6 小时(用户要求「几个小时一次」量级)。 */
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

const STORAGE_KEY = "shell.updatePresence.v1";

interface PresenceCache {
  checkedAt: number;
  release: ReleaseInfo | null;
}

export interface UpdatePresenceState {
  /** 最近一次检查到的最新发布;从未查到(失败/未查)为 null。 */
  latest: ReleaseInfo | null;
}

const store = createSubscribable<UpdatePresenceState>({ latest: null });

/** React 订阅;底栏版本提示按快照渲染。 */
export function useUpdatePresence(): UpdatePresenceState {
  return store.useStore();
}

/** 非 React 读取(测试/一次性判断)。 */
export function getUpdatePresence(): UpdatePresenceState {
  return store.snapshot;
}

/** 解析持久化缓存;损坏/形状不对一律按无缓存。 */
export function parsePresenceCache(raw: string | null): PresenceCache | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null) return null;
    const checkedAt = (v as Record<string, unknown>).checkedAt;
    if (typeof checkedAt !== "number" || !Number.isFinite(checkedAt)) return null;
    return { checkedAt, release: ((v as Record<string, unknown>).release ?? null) as ReleaseInfo | null };
  } catch {
    return null;
  }
}

/** 距上次检查是否已到节流间隔(= 即到期)。 */
export function isCheckDue(checkedAt: number, now: number): boolean {
  return now - checkedAt >= UPDATE_CHECK_INTERVAL_MS;
}

function readCache(): PresenceCache | null {
  try {
    return parsePresenceCache(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function writeCache(cache: PresenceCache): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    /* 隐私模式/配额满:提示降级为会话内存态,不致命。 */
  }
}

/** 检查结论回填(弹窗手动检查与后台检查共用);checkedAt 记成功时刻。 */
export function recordPresenceCheck(release: ReleaseInfo | null, now = Date.now()): void {
  writeCache({ checkedAt: now, release });
  store.commit({ latest: release });
}

/** 节流检查:未到期直接跳过;成功记账,失败不记账(下个周期重试)。 */
export async function maybeCheckForUpdate(now = Date.now()): Promise<void> {
  const cache = readCache();
  if (cache && !isCheckDue(cache.checkedAt, now)) return;
  const result = await checkLatestRelease();
  if (result.error === null) recordPresenceCheck(result.release, now);
}

let started = false;

/** 应用启动初始化:先亮缓存结论,再按节流补一次后台检查 + 周期兜底。幂等。 */
export function initUpdatePresence(): void {
  if (started) return;
  started = true;
  const cache = readCache();
  if (cache) store.commit({ latest: cache.release });
  void maybeCheckForUpdate();
  setInterval(() => void maybeCheckForUpdate(), UPDATE_CHECK_INTERVAL_MS);
}
