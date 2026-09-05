/**
 * 命令注册表 + 快捷键分发器 —— 应用内全局快捷键的内核通用原语。
 *
 * 分工铁律(spec 2026-09-05-shortcuts-design):内核只放注册面/分发器/作用域裁决,
 * 键位语义(id/title/keybinding/run/when)由拥有该功能的插件经 ctx.registerCommand
 * 贡献;内核不认识任何业务命令。
 *
 * 作用域模型:
 * - "global":常规分发器(window keydown capture 单点,AppShell 安装)。
 * - "terminal":终端聚焦时按键直接进 PTY,分发器收不到;只有终端作用域命令
 *   经 TerminalView 的 attachCustomKeyEventHandler 桥触发(一期仅 terminal.find,
 *   终端内自由快捷键行为与桥接入前完全一致)。
 *
 * 纪律:isComposing(IME 组词)一律放行;Escape 永不注册(保护约 20 处弹层
 * Esc 生态);同 id 重复注册与同键重复绑定直接抛错(一期固定键位,冲突即 bug);
 * 停用插件 = 重启后不激活(pluginLifecycle 范式),运行期不反注销。
 */

import { useSyncExternalStore } from "react";

/** 分发器/终端桥共用的最小按键面(xterm 桥传入的是其 KeyboardEvent 子集)。 */
export interface ShortcutKeyEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export interface CommandContribution {
  /** 全局唯一,约定 `<owner>.<action>`,如 "git.commit"、"shell.toggleLeftBar"。 */
  id: string;
  /** 设置清单展示名(中文)。 */
  title: string;
  /**
   * 键位串,修饰键前缀写法:"Cmd+K"、"Cmd+Shift+E"、"Cmd+Alt+B"、"Cmd+1"。
   * Cmd 在 macOS 匹配 metaKey、其他平台匹配 ctrlKey(二者任一即视为按下)。
   * 缺省 = 未绑定,仅进注册表(设置清单以「未绑定」呈现,为改键期备数据面)。
   */
  keybinding?: string;
  /** 自定义匹配(键位区间如 ⌘1-9);提供时忽略 keybinding 的解析匹配。 */
  match?: (e: ShortcutKeyEvent) => boolean;
  /** 展示用键位标签(如 "⌘1-9");缺省由 keybinding 推导。 */
  keybindingLabel?: string;
  /** 上下文谓词;抛错或不满足 = 不吃键(穿透,不 preventDefault)。 */
  when?: () => boolean;
  /** 缺省 "global"。 */
  scope?: "global" | "terminal";
  run: () => void;
}

const commands = new Map<string, CommandContribution>();
const listeners = new Set<() => void>();
let snapshot: CommandContribution[] = [];

function refreshSnapshot(): void {
  snapshot = [...commands.values()].sort((a, b) => a.id.localeCompare(b.id));
  listeners.forEach((fn) => fn());
}

/** 解析键位串;无法解析(无修饰键/空键名)返回 null —— 调用方按注册错误处理。 */
function parseKeybinding(kb: string): {
  key: string;
  meta: boolean;
  shift: boolean;
  alt: boolean;
} | null {
  const parts = kb.split("+").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null; // 裸键不做全局拦截(会吞掉正常输入)
  let meta = false;
  let shift = false;
  let alt = false;
  for (const p of parts.slice(0, -1)) {
    if (p === "Cmd") meta = true;
    else if (p === "Shift") shift = true;
    else if (p === "Alt") alt = true;
    else return null;
  }
  const key = parts[parts.length - 1].toLowerCase();
  if (!key) return null;
  return { key, meta, shift, alt };
}

function eventMatches(cmd: CommandContribution, e: ShortcutKeyEvent): boolean {
  if (cmd.match) return cmd.match(e);
  if (!cmd.keybinding) return false;
  const parsed = parseKeybinding(cmd.keybinding);
  if (!parsed) return false;
  if ((e.metaKey || e.ctrlKey) !== parsed.meta) return false;
  if (e.shiftKey !== parsed.shift) return false;
  if (e.altKey !== parsed.alt) return false;
  return e.key.toLowerCase() === parsed.key;
}

function whenOk(cmd: CommandContribution): boolean {
  if (!cmd.when) return true;
  try {
    return cmd.when();
  } catch {
    return false; // 谓词异常按不满足处理:键穿透,不吞键
  }
}

function safeRun(cmd: CommandContribution): void {
  try {
    cmd.run();
  } catch (err) {
    console.error(`[shortcuts] 命令执行失败: ${cmd.id}`, err);
  }
}

/** 注册一条命令。同 id 重复或同键重复绑定视为插件 bug,直接抛错(fail fast)。 */
export function registerCommand(cmd: CommandContribution): void {
  if (commands.has(cmd.id)) {
    throw new Error(`命令重复注册: ${cmd.id}`);
  }
  if (cmd.keybinding && !cmd.match) {
    const parsed = parseKeybinding(cmd.keybinding);
    if (!parsed) {
      throw new Error(`命令键位无法解析(需 Cmd 前缀): ${cmd.id} ${cmd.keybinding}`);
    }
    if (parsed.key === "escape") {
      throw new Error(`命令不允许绑定 Escape: ${cmd.id}`);
    }
    for (const other of commands.values()) {
      if ((other.scope ?? "global") !== (cmd.scope ?? "global")) continue;
      if (!other.keybinding || other.match) continue; // match 型命令不参与静态键位冲突
      const otherParsed = parseKeybinding(other.keybinding);
      if (!otherParsed) continue;
      const sameKey =
        otherParsed.key === parsed.key &&
        otherParsed.meta === parsed.meta &&
        otherParsed.shift === parsed.shift &&
        otherParsed.alt === parsed.alt;
      /* 同键允许的前提:双方都有 when 且调用方承诺互斥(如 ⌘S 按激活 tab kind 分家);
         任一方无 when = 真冲突,抛错。分发器按注册序先命中先吃。 */
      if (sameKey && !(cmd.when && other.when)) {
        throw new Error(`快捷键重复绑定: ${cmd.id} 与 ${other.id} 都绑定了 ${cmd.keybinding}`);
      }
    }
  }
  commands.set(cmd.id, cmd);
  refreshSnapshot();
}

/** 终端桥查询:xterm attachCustomKeyEventHandler 用;只匹配 terminal 作用域命令。 */
export function matchTerminalCommand(e: ShortcutKeyEvent): CommandContribution | undefined {
  for (const cmd of commands.values()) {
    if (cmd.scope !== "terminal") continue;
    if (eventMatches(cmd, e) && whenOk(cmd)) return cmd;
  }
  return undefined;
}

/** 终端聚焦态(TerminalView 馈入):聚焦期间 global 分发器完全静默,键照旧进 PTY。 */
let terminalFocused = false;
export function setTerminalFocused(focused: boolean): void {
  terminalFocused = focused;
}

/** 安装全局分发器(AppShell 挂载期调用一次);返回退订函数。 */
export function installShortcutDispatcher(): () => void {
  const onKey = (e: KeyboardEvent): void => {
    if (e.isComposing) return; // IME 组词期全放行
    if (terminalFocused) return; // 终端内自由快捷键不变:只有 terminal 作用域走 xterm 桥
    for (const cmd of commands.values()) {
      if (eventMatches(cmd, e) && whenOk(cmd)) {
        e.preventDefault();
        e.stopPropagation();
        safeRun(cmd);
        return;
      }
    }
  };
  window.addEventListener("keydown", onKey, true);
  return () => window.removeEventListener("keydown", onKey, true);
}

/** 注册表快照(设置清单数据源,按 id 字典序稳定排序)。 */
export function getCommands(): readonly CommandContribution[] {
  return snapshot;
}

export function useCommands(): CommandContribution[] {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => snapshot,
  );
}

/** 键位串 → 展示标签("Cmd+Shift+E" → "⌘⇧E";非 mac 心智暂不区分,与现有 ⌘ 提示一致)。 */
export function formatKeybinding(kb: string): string {
  return kb
    .split("+")
    .map((p) => {
      const t = p.trim();
      if (t === "Cmd") return "⌘";
      if (t === "Shift") return "⇧";
      if (t === "Alt") return "⌥";
      return t === "," ? "," : t.toUpperCase();
    })
    .join("");
}
