/**
 * 命令注册表 + 快捷键分发器 —— 应用内全局快捷键的内核通用原语。
 *
 * 分工铁律(spec 2026-09-05-shortcuts-design):内核只放注册面/分发器/作用域裁决,
 * 键位语义(id/title/keybinding/run/when)由拥有该功能的插件经 ctx.registerCommand
 * 贡献;内核不认识任何业务命令。
 *
 * 作用域模型:
 * - "global":常规分发器(window keydown capture 单点,AppShell 安装),终端聚焦期
 *   照常触发 —— 命中即 capture 相位拦截,事件到不了 xterm,零 PTY 字节;⌘ 系键位
 *   在终端生态本就不进 PTY,终端内 CLI 零感知(spec 2026-09-06-shortcuts-terminal-focus)。
 * - "terminal":终端聚焦期由分发器优先分发(原 xterm attachCustomKeyEventHandler 桥
 *   已并入);未命中键原样进 PTY,终端自由快捷键(readline 等)不变。
 *
 * 纪律:isComposing(IME 组词)一律放行;Escape 永不注册(保护约 20 处弹层
 * Esc 生态);⌘C/⌘V 永不注册(终端复制粘贴生态);同 id 重复注册与同键重复绑定
 * 直接抛错(一期固定键位,冲突即 bug);停用插件 = 重启后不激活(pluginLifecycle
 * 范式),运行期不反注销。
 */

import { useSyncExternalStore } from "react";
import { getPlatformKind } from "./platform";

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
   * Cmd 平台严格分流:macOS 仅匹配 metaKey,其他平台仅匹配 ctrlKey ——
   * macOS 的 Ctrl+键是终端/Emacs 键生态(⌃A/⌃E/⌃K…),不得被全局快捷键劫持;
   * unknown(纯浏览器 dev 探测失败)保持二者任一的宽松兜底。
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
  /* 平台严格分流(见 CommandContribution.keybinding):macOS 仅 metaKey、
     其他平台仅 ctrlKey;unknown 宽松兜底(二者任一)。 */
  const kind = getPlatformKind();
  const cmdPressed =
    kind === "macos" ? e.metaKey : kind === "unknown" ? e.metaKey || e.ctrlKey : e.ctrlKey;
  if (cmdPressed !== parsed.meta) return false;
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

/** 终端作用域匹配器:分发器在终端聚焦期优先查询(原 xterm 桥已并入分发器)。 */
export function matchTerminalCommand(e: ShortcutKeyEvent): CommandContribution | undefined {
  for (const cmd of commands.values()) {
    if (cmd.scope !== "terminal") continue;
    if (eventMatches(cmd, e) && whenOk(cmd)) return cmd;
  }
  return undefined;
}

/** 终端聚焦态(TerminalView 馈入):聚焦期间 terminal 作用域优先、global 照常分发,
 *  命中即拦截不进 PTY;未命中键原样进 PTY,终端自由快捷键不变。 */
let terminalFocused = false;
export function setTerminalFocused(focused: boolean): void {
  terminalFocused = focused;
}

/** 分发决策(纯函数,分发器与测试共用):终端聚焦时先查 terminal 作用域(同键跨作用域
 *  时终端优先,如 global ⌘F 与 terminal.find),未命中再落 global;非聚焦只查 global。 */
export function resolveCommand(e: ShortcutKeyEvent): CommandContribution | undefined {
  if (terminalFocused) {
    const terminal = matchTerminalCommand(e);
    if (terminal) return terminal;
  }
  for (const cmd of commands.values()) {
    if (cmd.scope === "terminal") continue;
    if (eventMatches(cmd, e) && whenOk(cmd)) return cmd;
  }
  return undefined;
}

/** 安装全局分发器(AppShell 挂载期调用一次);返回退订函数。 */
export function installShortcutDispatcher(): () => void {
  const onKey = (e: KeyboardEvent): void => {
    if (e.isComposing) return; // IME 组词期全放行
    const cmd = resolveCommand({
      key: e.key,
      metaKey: e.metaKey,
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
    });
    if (!cmd) return; // 未命中穿透:终端内自由快捷键(readline 等)原样进 PTY
    e.preventDefault();
    e.stopPropagation();
    safeRun(cmd);
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
