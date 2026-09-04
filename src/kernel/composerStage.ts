/**
 * Composer(对话框)四段式高度 stage —— kernel 级 store。
 *
 * 为什么在 kernel:stage 的消费者跨层 —— ComposerToolbar(插件,↑↓ 按钮在此)写,
 * AppShell(外壳,持有 composer Panel 的 panelRef)读并编程式 resize。
 * R4 禁止插件 import 外壳,AppShell 又不能挂插件模块 —— kernel store 是唯一合规汇合点。
 *
 * 四段定长(react-resizable-panels 百分比;点一次走一段,两端停):
 * - expanded 70%(大输入面;幕布让位)
 * - normal 30%(常规;= AppShell composer Panel defaultSize)
 * - compact 20%(紧凑)
 * - collapsed 10%(仅工具栏条;= composer Panel 的 minSize)
 *
 * ↑ 逐级展开(到 expanded 停);↓ 逐级收起(到 collapsed 停)。
 */

import { useSyncExternalStore } from "react";

type ComposerStage = "expanded" | "normal" | "compact" | "collapsed";

/** 段序:展开端 → 收起端。转移 = 沿此数组移动一格,两端截断。 */
const STAGE_ORDER: readonly ComposerStage[] = ["expanded", "normal", "compact", "collapsed"];

/** stage → composer Panel 占比(0..100;canvas = 100 − 此值)。 */
export const COMPOSER_STAGE_SIZE: Record<ComposerStage, number> = {
  expanded: 70,
  normal: 30,
  compact: 20,
  collapsed: 10,
};

/**
 * separator 键盘调尺寸的单键步长(%;实测本库为 5)。
 * 四段目标均为 5 的倍数 → 键数 = round(Δ/5) 精确到达。
 */
export const COMPOSER_RESIZE_STEP = 5;

const DEFAULT_COMPOSER_STAGE: ComposerStage = "normal";

let stage: ComposerStage = DEFAULT_COMPOSER_STAGE;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

export function getComposerStage(): ComposerStage {
  return stage;
}

export function setComposerStage(next: ComposerStage): void {
  if (stage === next) return;
  stage = next;
  emit();
}

function step(delta: -1 | 1): void {
  const idx = STAGE_ORDER.indexOf(stage);
  const next = STAGE_ORDER[Math.min(STAGE_ORDER.length - 1, Math.max(0, idx + delta))];
  setComposerStage(next);
}

/** ↑ 逐级展开(到 expanded 停)。 */
export function expandComposerStage(): void {
  step(-1);
}

/** ↓ 逐级收起(到 collapsed 停)。 */
export function collapseComposerStage(): void {
  step(1);
}

export function useComposerStage(): ComposerStage {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getComposerStage,
  );
}
