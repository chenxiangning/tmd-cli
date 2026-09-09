/**
 * 快捷键改写覆盖层 + 录制闸 —— kernel/shortcuts.ts 拆出的辅助模块(300 行铁则)。
 *
 * 承担:
 * - `setShortcutOverrides`/`getEffectiveKeybinding`/`isShortcutRemappable`:运行期 effective
 *   键位解析;`settings.ts` 装载/变更时喂入,触发与 `useCommands` 同一份 listener 群,
 *   保证 UI 清单 + 分发器 + tooltip 三处共享同一 effective 视图。
 * - `validateOverride`:录制期冲突校验(同作用域同键 + 非双方 when 互斥 → 拒绝)。
 * - 录制闸门:`isShortcutRecording`/`setShortcutRecording`,`installShortcutDispatcher` 早
 *   返回期间 ShortcutTab 接管下一次 keydown;带 60s 自动超时防呆。
 * 修饰键语义:`parseKeybinding` 接受 "Cmd" / "Shift" / "Alt" + 主键,主键无修饰键视为非法
 * (全局快捷键吞键风险);Escape/⌘C/⌘V 黑名单继承自 `registerCommand` 同款规则。
 */
import { useSyncExternalStore } from "react";
import {
  formatKeybinding,
  getCommands,
  keybindingChips,
  parseKeybinding,
  type ShortcutKeyEvent,
} from "./shortcuts";

/** 录制闸门 60s 超时定时器句柄类型别名(避免 `ReturnType<typeof setTimeout>` 露底)。 */
type TimerHandle = ReturnType<typeof setTimeout>;

let overrides: Record<string, string> = {};
const listeners = new Set<() => void>();
let snapshotVersion = 0;
let lastEmittedVersion = 0;
let cachedSnapshot: Record<string, string> = overrides;

function emit(): void {
  cachedSnapshot = overrides;
  lastEmittedVersion = snapshotVersion;
  listeners.forEach((fn) => fn());
}

/** 喂入(同 `setShortcutOverrides`),覆写整张表;settings 装载/变更时调用。 */
export function setShortcutOverrides(next: Record<string, string>): void {
  overrides = { ...next };
  snapshotVersion++;
  emit();
}

/** 非 React 读取(录制流期间校验冲突时使用)。 */
export function getShortcutOverridesSnapshot(): Record<string, string> {
  if (snapshotVersion !== lastEmittedVersion) {
    cachedSnapshot = overrides;
    lastEmittedVersion = snapshotVersion;
  }
  return cachedSnapshot;
}

/** React 订阅快捷键改写层版本号;用于 `useCommands` 同步刷新。 */
export function useShortcutOverridesVersion(): number {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => lastEmittedVersion,
  );
}

/**
 * 取 effective 键位(改写优先;空串 = 显式解绑返回 undefined,UI 标「未设置」;未注册 id 返回 undefined)。
 * 不做修饰键分流(留给 `eventMatches` 调 `parseKeybinding`),只透出原始串;UI 经 `formatKeybinding` 标签化。
 */
export function getEffectiveKeybinding(id: string): string | undefined {
  const cmd = getCommands().find((c) => c.id === id);
  if (!cmd) return undefined;
  const value = overrides[id];
  if (value === "") return undefined;
  if (value !== undefined) return value;
  return cmd.keybinding;
}

/** 是否可被用户改写:有静态 keybinding 且非 match 型(match 的区间/双修饰语法录不成单键);
 *  无默认键位的命令一律「内置」置灰(与设置页/规格的已知上限一致)。 */
export function isShortcutRemappable(id: string): boolean {
  const cmd = getCommands().find((c) => c.id === id);
  if (!cmd) return false;
  return !cmd.match && cmd.keybinding !== undefined;
}

/* ── 录制闸门 ───────────────────────────────────────────── */

let recording = false;
let recordingTimeout: TimerHandle | null = null;
const RECORDING_TIMEOUT_MS = 60_000;

/** 录制闸门:为 true 时 `installShortcutDispatcher` 的 window keydown 早返回(不命中、不拦截)。 */
export function isShortcutRecording(): boolean {
  return recording;
}

/** 开启/关闭录制闸门;开启时设 60s 自动超时(onTimeout 通知 UI 同步退出录制态),防止切走窗口卡键。 */
export function setShortcutRecording(on: boolean, onTimeout?: () => void): void {
  recording = on;
  if (recordingTimeout) {
    clearTimeout(recordingTimeout);
    recordingTimeout = null;
  }
  if (on) {
    recordingTimeout = setTimeout(() => {
      recording = false;
      recordingTimeout = null;
      onTimeout?.();
    }, RECORDING_TIMEOUT_MS);
  }
}
/* ── 录制期冲突校验 ───────────────────────────────────── */

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: "escape-forbidden" | "missing-modifier" | "syntax" | "conflict"; detail?: string };

/** 录制期一次按键校验:`value` = 候选键位串(已规范化或待解析),`cmdId` = 被改写的命令。 */
export function validateOverride(cmdId: string, value: string): ValidationResult {
  if (value === "") return { ok: true };
  const parsed = parseKeybinding(value);
  if (!parsed) {
    const parts = value.split("+").map((p) => p.trim()).filter(Boolean);
    if (parts.length === 1) return { ok: false, reason: "missing-modifier" };
    return { ok: false, reason: "syntax" };
  }
  if (parsed.key === "escape") return { ok: false, reason: "escape-forbidden" };
  const self = getCommands().find((c) => c.id === cmdId);
  if (!self) return { ok: false, reason: "syntax" };
  const selfScope = self.scope ?? "global";
  const synthEvent: ShortcutKeyEvent = {
    key: parsed.key,
    metaKey: parsed.meta,
    ctrlKey: false,
    shiftKey: parsed.shift,
    altKey: parsed.alt,
  };
  for (const other of getCommands()) {
    if (other.id === cmdId) continue;
    if ((other.scope ?? "global") !== selfScope) continue;
    if (other.match) {
      // match 型(⌘1-9 / Ctrl+Tab):用合成事件反演试配,命中即冲突(双方 when 互斥放行)
      if (other.match(synthEvent) && !(self.when && other.when)) {
        return { ok: false, reason: "conflict", detail: other.id };
      }
      continue;
    }
    const otherKb = getEffectiveKeybinding(other.id);
    if (!otherKb) continue;
    const otherParsed = parseKeybinding(otherKb);
    if (!otherParsed) continue;
    if (
      otherParsed.key === parsed.key &&
      otherParsed.meta === parsed.meta &&
      otherParsed.shift === parsed.shift &&
      otherParsed.alt === parsed.alt
    ) {
      if (!(self.when && other.when)) {
        return { ok: false, reason: "conflict", detail: other.id };
      }
    }
  }
  return { ok: true };
}

const NAMED_KEYS = new Set([
  "escape", "tab", "enter", "backspace", "delete", "space",
  "arrowup", "arrowdown", "arrowleft", "arrowright",
  "home", "end", "pageup", "pagedown",
]);

/** 录制期一次性:把 KeyboardEvent 转键位串("Cmd+Shift+K" 形式),用于 pass-through 校验。 */
export function formatKeyEvent(e: ShortcutKeyEvent): string {
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push("Cmd");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");
  const key = e.key === " " ? "space" : (e.key || "").toLowerCase();
  if (parts.length === 0) return "";
  const isFKey = /^f\d{1,2}$/.test(key);
  const isSingleChar = key.length === 1;
  if (!isSingleChar && !isFKey && !NAMED_KEYS.has(key)) return "";
  parts.push(key);
  return parts.join("+");
}


/** 派生:effective 展示标签("未设置" 返回 null;match 型/未注册返回 null);Tooltip 入口复用。 */
export function useEffectiveKeybindingLabel(id: string): string | null {
  useShortcutOverridesVersion();
  const cmd = getCommands().find((c) => c.id === id);
  if (!cmd) return null;
  // match 型命令用 keybindingLabel 静态展示(无 keybinding 概念)
  if (cmd.match) return cmd.keybindingLabel ?? null;
  const effective = getEffectiveKeybinding(id);
  if (!effective) return null;
  return formatKeybinding(effective);
}

/** 派生:effective 键帽分段(Tooltip 逐键渲染);match 型返回 null(其 label 走 useEffectiveKeybindingLabel)。 */
export function useEffectiveKeybindingChips(id: string): string[] | null {
  useShortcutOverridesVersion();
  const cmd = getCommands().find((c) => c.id === id);
  if (!cmd || cmd.match) return null;
  const effective = getEffectiveKeybinding(id);
  if (!effective) return null;
  return keybindingChips(effective);
}
