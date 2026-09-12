/**
 * 插件崩溃熔断 —— 渲染崩溃按插件归属计数,阈值(3 次/会话)隔离。
 *
 * PluginBoundary(注册期包裹的贡献组件)recordCrash;触发后:
 * handler 由 HostRegistry 注册(贡献摘除 + 激活表移除 + 外壳重渲染),
 * 本模块只管计数、隔离集合与订阅分发,不认识注册表(免模块环)。
 * 熔断是会话内运行时态:重启即恢复(重新过激活流程)。
 */
import { createSubscribable } from "./subscribable";

export const QUARANTINE_CRASH_THRESHOLD = 3;

const crashes = new Map<string, number>();
const reasons = new Map<string, string>();
const quarantined = new Set<string>();
const store = createSubscribable<ReadonlySet<string>>(new Set());

let handler: ((id: string) => void) | null = null;

/** 摘除通道注册(HostRegistry 构造时挂;后注册者覆盖,测试注意)。 */
export function setQuarantineHandler(fn: (id: string) => void): void {
  handler = fn;
}

export function isQuarantined(id: string): boolean {
  return quarantined.has(id);
}

/** 熔断原因(市场页徽章 tooltip;未熔断 = undefined)。 */
export function getQuarantineReason(id: string): string | undefined {
  return reasons.get(id);
}

/** 熔断集合订阅快照(React useSyncExternalStore 面)。 */
export function useQuarantinedPlugins(): ReadonlySet<string> {
  return store.useStore();
}

/** 记一次渲染崩溃;达到阈值触发熔断并调摘除通道。返回是否本次刚熔断。 */
export function recordPluginCrash(id: string, reason: string): boolean {
  if (quarantined.has(id)) return false;
  const count = (crashes.get(id) ?? 0) + 1;
  crashes.set(id, count);
  if (count < QUARANTINE_CRASH_THRESHOLD) return false;
  quarantined.add(id);
  if (reason) reasons.set(id, reason);
  store.commit(new Set(quarantined));
  handler?.(id);
  return true;
}

/** 测试接缝:清计数/隔离态/handler。 */
export function __resetPluginQuarantineForTests(): void {
  crashes.clear();
  reasons.clear();
  quarantined.clear();
  store.commit(new Set());
  handler = null;
}
