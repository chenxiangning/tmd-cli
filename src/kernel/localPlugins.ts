/**
 * 本地插件装载编排:扫描→diff(SHA-256)→读回核哈希→装载→信任闸→晚激活;对话即变(turnSettled 自动重扫)。
 * 状态表在 localPluginStore;信任绑定内容 hash(settings.localPluginTrust,SHA-256 判据)。
 * 设计契约见 docs/superpowers/specs/2026-09-10-local-plugins-design.md。
 */
import { KernelTopics } from "./events";
import { host } from "./host";
import { ipc } from "./ipc";
import {
  importBundle,
  sdkShimKey,
  synthesizeMeta,
  validatePluginExport,
} from "./localPluginLoad";
import {
  activatable,
  entryNameOf,
  markActivated,
  scanToRecord,
  trustToken,
} from "./localPluginScan";
import { installPluginSdkShim } from "./pluginSdk";
import type { Plugin } from "./plugin";
import { getSettingsState, settingsReady, updateSettings } from "./settings";
import {
  __resetLocalPluginStoreForTests,
  emit,
  records,
  type LocalPluginRecord,
} from "./localPluginStore";

export { getLocalPluginRecords, subscribeLocalPlugins, useLocalPluginRecords } from "./localPluginStore";
export type { LocalPluginRecord } from "./localPluginStore";
/** 公开 API 保持原位(信任闸已拆至 localPluginScan,此处转发;消费方路径不变)。 */
export { isContentTrusted, trustToken } from "./localPluginScan";

/** 已装载模块缓存:key = `${id}:${contentHash}`,diff 幂等的载体(同内容零 import)。 */
const loadedPlugins = new Map<string, Plugin>();
let builtinIds: ReadonlySet<string> = new Set();
let rescanFlight: Promise<void> | null = null;
let turnSettledSubscribed = false;

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}


/** 装载(带按内容指纹的缓存):校验已过 → 读 bundle(读+哈希原子出证)→ 内容核对 → import → 导出校验。 */
async function ensureLoaded(rec: LocalPluginRecord): Promise<Plugin | null> {
  const key = `${rec.id}:${rec.contentHash}`;
  const cached = loadedPlugins.get(key);
  if (cached) return cached;
  if (!rec.manifest || !rec.contentHash) return null;
  let file: { content: string; sha256: string };
  try {
    file = await ipc.pluginReadFile(rec.id, entryNameOf(rec.manifest));
  } catch (e) {
    rec.error = msg(e);
    return null;
  }
  /* 信任闸闭环:读回哈希 ≠ 扫描定戳 = 文件被换过(AI 仍写或恶意替换),拒装。 */
  if (file.sha256 !== rec.contentHash) {
    rec.error = "入口内容与扫描时不一致,已拒绝装载,请重新扫描";
    return null;
  }
  let mod: Record<string, unknown>;
  try {
    /* 装载前一刻按 manifest.permissions 装配 tmd-sdk 实例(key 带内容 hash,热更即新实例)。 */
    const sdkKey = sdkShimKey(rec.id, rec.contentHash);
    installPluginSdkShim(sdkKey, rec.permissions ?? []);
    mod = await importBundle(file.content, sdkKey);
  } catch (e) {
    const m = msg(e);
    rec.error = m.includes("module specifier")
      ? `装载失败: ${m}(specifier 重写仅支持 from "…" 与 import("…") 两种形态,副作用导入 import "…" 不支持)`
      : `装载失败: ${m}`;
    return null;
  }
  const verr = validatePluginExport(mod, rec.id);
  if (verr) {
    rec.error = verr;
    return null;
  }
  const raw = (mod.default ?? mod.plugin) as Plugin;
  const plugin = {
    ...raw,
    meta: raw.meta ?? synthesizeMeta(rec.manifest),
    permissions: rec.permissions ?? [],
  };
  loadedPlugins.set(key, plugin);
  return plugin;
}

function subscribeTurnSettled(): void {
  if (turnSettledSubscribed) return;
  turnSettledSubscribed = true;
  /* 对话即变:AI 落盘插件 → 一轮对话结算 → 静默重扫。「写完文件」就是 AI 侧的全部契约。 */
  host.events.on(KernelTopics.turnSettled, () => {
    void rescanLocalPlugins();
  });
}

/**
 * boot 装载:返回**已信任且启用**的插件清单,由 main.tsx 在内置激活完成后交
 * activateBootLocals 晚激活(内置激活时序零变化)。
 * 总开关 localPluginsDisabled 为真时不扫描不装载(一键还原干净内置态)。
 */
export async function bootLocalPlugins(builtins: ReadonlySet<string>): Promise<Plugin[]> {
  builtinIds = builtins;
  await settingsReady; // 信任表/总开关/拔插名单都在 settings 里,等首载完再读(默认空值竞态)
  subscribeTurnSettled();
  if (getSettingsState().settings.localPluginsDisabled) return [];
  const entries = await ipc.pluginScan().catch(() => null);
  if (!entries) return [];
  /* boot 可重入(测试/未来的手动重载):先清旧登记,避免已从磁盘消失的插件留僵尸记录。 */
  records.clear();
  /* 装载互不依赖,并发读+import(内容指纹缓存兜底);records 登记仍按 entries
     原序(各 lambda 同步前缀依次执行),ready 保持原序。 */
  const loaded = await Promise.all(
    entries.map(async (entry) => {
      const rec = scanToRecord(entry, builtinIds);
      records.set(rec.id, rec);
      if (!activatable(rec)) return null;
      // activatedHash 由 activateBootLocals 真实激活后落(markActivated)
      return ensureLoaded(rec);
    }),
  );
  const ready = loaded.filter((p): p is Plugin => p !== null);
  emit();
  return ready;
}

/**
 * boot 本地插件的拓扑晚激活:按 dependsOn 分层激活(本地可依赖内置或先激活的本地);
 * 单插件失败落 activateError 并 continue,绝不中断后续(故障隔离承诺)。
 */
export async function activateBootLocals(plugins: Plugin[]): Promise<void> {
  const pending = new Map(plugins.map((p) => [p.id, p]));
  const done = new Set<string>();
  let progressed = true;
  while (pending.size > 0 && progressed) {
    progressed = false;
    for (const [id, p] of [...pending]) {
      const missing = (p.dependsOn ?? []).filter((d) => !builtinIds.has(d) && !done.has(d));
      if (missing.length > 0) continue;
      pending.delete(id);
      /* 已激活(StrictMode 双跑)只补戳;activate 抛错上抛(占位已回滚),落记录 continue。 */
      if (host.isPluginActive(id)) {
        markActivated(id);
        done.add(id);
        progressed = true;
        continue;
      }
      try {
        await host.activateLate(p);
        markActivated(id);
        done.add(id);
      } catch (e) {
        const rec = records.get(id);
        if (rec) rec.activateError = msg(e);
      }
      progressed = true;
    }
  }
  if (pending.size > 0) {
    const ids = [...pending.keys()].join(", ");
    for (const id of pending.keys()) {
      const rec = records.get(id);
      if (rec) rec.activateError = `依赖缺失或依赖环: ${ids}`;
    }
  }
  emit();
}

/** 重扫(单飞闸:并发触发共享同一 Promise,杜绝重复扫描/import)。 */
export function rescanLocalPlugins(): Promise<void> {
  if (!rescanFlight) {
    rescanFlight = doRescan().finally(() => {
      rescanFlight = null;
    });
  }
  return rescanFlight;
}

async function doRescan(): Promise<void> {
  await settingsReady;
  if (getSettingsState().settings.localPluginsDisabled) return;
  const entries = await ipc.pluginScan().catch(() => null);
  if (!entries) return;
  const seen = new Set<string>();
  for (const entry of entries) {
    seen.add(entry.id);
    const rec = scanToRecord(entry, builtinIds);
    records.set(rec.id, rec);
    if (rec.activatedHash) continue; // 已激活:仅更新内容戳(变更徽章),重启生效,不重载
    if (!activatable(rec)) continue;
    const plugin = await ensureLoaded(rec);
    if (!plugin) continue;
    try {
      await host.activateLate(plugin);
      markActivated(rec.id);
    } catch (e) {
      rec.activateError = msg(e);
    }
  }
  for (const id of [...records.keys()]) {
    if (!seen.has(id)) records.set(id, { ...records.get(id)!, removed: true });
  }
  emit();
}

/** 信任闸确认:信任当前内容指纹 + 归档版本库 + 未激活则立即晚激活免重启;已激活 = 重启生效。 */
export async function confirmLocalPlugin(id: string): Promise<void> {
  const rec = records.get(id);
  if (!rec?.contentHash) return;
  const s = getSettingsState().settings;
  const list = s.localPluginTrust[id] ?? [];
  const token = trustToken(rec.contentHash, rec.manifestHash);
  if (!list.includes(token)) {
    updateSettings({
      localPluginTrust: { ...s.localPluginTrust, [id]: [...list, token] },
    });
  }
  await ipc.pluginArchive(id).catch(() => null); // 归档失败不阻断确认(版本库是增强件)
  if (rec.activatedHash) {
    emit();
    return;
  }
  const plugin = await ensureLoaded(rec);
  if (!plugin) {
    emit();
    return;
  }
  try {
    await host.activateLate(plugin);
    markActivated(rec.id);
  } catch (e) {
    rec.activateError = msg(e);
  }
  emit();
}

/** 版本回退:Rust 侧先归档当前版再换回;随后重扫刷新内容戳(已确认 hash 免再过闸)。 */
export async function rollbackLocalPlugin(id: string, file: string): Promise<void> {
  await ipc.pluginRollback(id, file);
  await rescanLocalPlugins();
}

/** 测试接缝:清空模块态(host/events 单例桩按文件隔离,订阅标记保留防重复订阅)。 */
export function __resetLocalPluginsForTests(): void {
  records.clear();
  loadedPlugins.clear();
  __resetLocalPluginStoreForTests();
  rescanFlight = null;
}
