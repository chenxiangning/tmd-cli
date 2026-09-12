/**
 * 本地插件状态表(插排页本地分区数据源的存储层):
 * records Map + useSyncExternalStore 快照;装载编排见 localPlugins.ts,UI 见 plugins/local-loader。
 */
import { useSyncExternalStore } from "react";
import type { LocalPluginFileStamp } from "./ipc";
import type { PluginMeta } from "./plugin";

/** 本地插件记录:activatedHash = 已激活内容 hash,与 contentHash 不等即「已更新」。 */
export interface LocalPluginRecord {
  id: string;
  origin: "local";
  manifest: Record<string, unknown> | null;
  meta: PluginMeta | null;
  /** 当前磁盘入口内容 SHA-256(null = 入口缺失/校验失败)。 */
  contentHash: string | null;
  /** manifest 内容 SHA-256(信任闸双绑定的另一半;null = manifest 文件缺失)。 */
  manifestHash: string | null;
  /** 已声明权限(纯 UI 插件 = 空数组;manifest 缺失 = null)。 */
  permissions: string[] | null;
  /** 版本库清单(.versions/)。 */
  versions: LocalPluginFileStamp[];
  /** 加载失败原因(扫描/manifest/导出/链接期错误)。 */
  error: string | null;
  /** 激活失败原因(activate 抛错由晚激活调用方捕获;内容变更重扫时丢弃)。 */
  activateError: string | null;
  /** 已激活内容 hash;null = 未激活(待启用/被拔/未信任)。 */
  activatedHash: string | null;
  /** 目录已消失(卸载 = 重启后彻底消失)。 */
  removed: boolean;
}

export const records = new Map<string, LocalPluginRecord>();
const listeners = new Set<() => void>();
let snapshot: LocalPluginRecord[] = [];

export function emit(): void {
  snapshot = [...records.values()];
  listeners.forEach((l) => l());
}

export function subscribeLocalPlugins(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getLocalPluginRecords(): LocalPluginRecord[] {
  return snapshot;
}

export function useLocalPluginRecords(): LocalPluginRecord[] {
  return useSyncExternalStore(subscribeLocalPlugins, getLocalPluginRecords);
}

/** 测试接缝:清空状态表快照(编排侧缓存由 localPlugins 自己清)。 */
export function __resetLocalPluginStoreForTests(): void {
  records.clear();
  snapshot = [];
}
