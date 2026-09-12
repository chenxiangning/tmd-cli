/**
 * 首页数据模块级缓存 —— SWR:缓存先上屏 + 后台静默重验。
 *
 * welcome 随首页/会话切换反复卸载重挂,组件态一清零就全量重来:探针 spawn
 * 10+ 个 --version 进程、凭据盘点打供应商额度 HTTP(带退避重试)—— 回首页
 * 每次都慢的根因。落模块级后重挂即时呈现;重验不落 loading(无闪烁),
 * 值落定才覆盖 state。消费方 = WelcomePage(探针/最新版/凭据)。
 */

import { engineMetas } from "./engineMeta";
import type { EngineProbeState } from "./EngineCard";
import type { EngineCredential } from "./credentials";

export const probeCache = new Map<string, EngineProbeState>();
export const depProbeCache = new Map<string, EngineProbeState>();
export const latestCache = new Map<string, string | null>();
/** 最新版已拉取集(每次应用运行一次;失败移出,下次回首页重试)。 */
export const latestFetched = new Set<string>();
export const credsCache = new Map<string, EngineCredential[]>();

/** 初始探针态:命中缓存用缓存值(即时呈现),未命中才落 loading。 */
export function buildInitialProbes(): Record<string, EngineProbeState> {
  return Object.fromEntries(
    engineMetas().map((m) => [
      m.id,
      probeCache.get(m.id) ?? { status: "loading" as const, result: null },
    ]),
  );
}
