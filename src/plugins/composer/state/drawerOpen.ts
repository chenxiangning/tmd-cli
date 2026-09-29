/**
 * 命令抽屉开合 + 落位 store —— 模块级单例(同 attachments/filePanel 惯例)。
 *
 * 两端共享:ComposerToolbar(开关按钮在 statusbar Mount 树)、Composer(挂载抽屉)、
 * RailWakeIcons(输入轨双图标),彼此无 props 通道,经此 store 同步;
 * ⌘K / Esc / 点外关闭 / 图标直达都写这里。
 *
 * 2026-09-28 双图标(spec v2 状态机裁决,记录 docs/review/ 同日):
 * - requested = 抽屉落位意图(镜像实际 tab,applyDrawerSection 在 tab 变化时同步):
 *   「一次性消费」被废除 —— 落位由 CommandDrawer 订阅 want 值反应式裁决,
 *   关闭即清空,结构上不存在悬留泄漏;
 * - toggleDrawerSection:关→开带分区;已开@该分区→关(toggle 惯例);
 *   已开@他区→改 requested(值变化即驱动切区,无需 nonce);
 * - resolved = 本拍动态解析完成位(useComposerDrawer 写):「指定分区无条目
 *   回落全部」必须等两阶段数据可判后才裁决(P0-1 竞态修复的裁决闸口)。
 */

import { useSyncExternalStore } from "react";
import type { DrawerSection } from "../drawerItems";

/** 抽屉落位(含「全部」聚合位)。 */
export type DrawerTab = "all" | DrawerSection;

let open = false;
/** null = 全部;非空 = 分区意图(与 CommandDrawer tab 单向镜像同步)。 */
let requested: DrawerSection | null = null;
let resolved = false;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((fn) => fn());
}

/** 非 React 订阅(对齐 kernel/subscribable 的 subscribe 出口形状)。 */
export function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function isDrawerOpen(): boolean {
  return open;
}

export function setDrawerOpen(next: boolean): void {
  if (open === next) return;
  open = next;
  /* 打开复位 resolved:回落裁决只认本次打开的解析终拍;
     关闭清一次性意图(不许悬留到下次 ⌘K)。 */
  if (next) resolved = false;
  else requested = null;
  emit();
}

export function toggleDrawer(): void {
  setDrawerOpen(!open);
}

/** 轨图标开合:已开且就在该分区 = 关闭;否则开(或保持开)并请求落该分区。 */
export function toggleDrawerSection(section: DrawerTab): void {
  if (open && requested === (section === "all" ? null : section)) {
    setDrawerOpen(false);
    return;
  }
  const wasOpen = open;
  open = true;
  requested = section === "all" ? null : section;
  /* 由关转开走 setDrawerOpen 的复位语义;保持开只换意图,已判定数据不重来 */
  if (!wasOpen) resolved = false;
  emit();
}

/** CommandDrawer 的 tab 实际落位后镜像意图(emit:轨图标 active 态要跟随手动
 *  切 tab;值不变时 useSyncExternalStore 快照相等,不会触发回环重渲染)。 */
export function applyDrawerSection(tab: DrawerTab): void {
  const next = tab === "all" ? null : tab;
  if (requested === next) return;
  requested = next;
  emit();
}

/** 当前落位意图(null = 全部;轨图标 active 态与裁决读取)。 */
export function getDrawerSection(): DrawerSection | null {
  return requested;
}

export function getDrawerResolved(): boolean {
  return resolved;
}

export function useDrawerSection(): DrawerSection | null {
  return useSyncExternalStore(subscribe, getDrawerSection);
}

export function setDrawerResolved(next: boolean): void {
  if (resolved === next) return;
  resolved = next;
  emit();
}

export function useDrawerResolved(): boolean {
  return useSyncExternalStore(subscribe, getDrawerResolved);
}

export function useDrawerOpen(): boolean {
  return useSyncExternalStore(subscribe, isDrawerOpen);
}
