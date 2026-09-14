/**
 * 壁纸打穿引擎 —— 壁纸激活时把 chrome 表面 token 替换为半透明 color-mix,
 * 让沉在 z-index:-1 的壁纸层透出;关闭时按快照原值还原。
 *
 * 设计(对照 codemoss 650 行选择器清单的替代路线,见调研文档决策点 2):
 * - tmd-cli 全表面吃 --tmd-* token(theme.ts 内联写在 :root),覆盖 token
 *   即覆盖全部表面;popover/hover/accent 不在表内,弹层菜单保持实底可读。
 * - 覆盖值用「快照原色 + color-mix」,保留任意自定义 preset 的真实底色;
 *   terminal-bg 单独解析为 rgba 字面量 —— xterm 自行解析主题色,不认 color-mix。
 * - theme.ts 每次重应用会整批 remove+set 这些键(抹掉本引擎的覆盖):
 *   重打挂在 themeApplied 监听(refreshWallpaperPunch)内,theme.ts 的
 *   桥通知在监听循环之后才发出,故活幕布 xterm 重读必见打穿后的值。
 */

import { subscribeThemeApplied } from "@kernel/theme";
import { notifyTerminalThemeChanged } from "@kernel/terminalThemeBridge";

/**
 * 打穿 token 表:保留不透明度 %,其余全走原值。
 * 浓度对照 codemoss(其 chrome veil = 16% 不透明 + 壁纸层 8-10% wash)。
 * 不打穿 elevated:它同时承担「浮层实底」语义(菜单/下拉经
 * --surface-sidebar-opaque 指到它),打穿会让新建会话等弹层透视重叠
 * (codemoss 立场:popover 族保实底);常驻大面板走 --tmd-bg-panel
 * 单独打穿,内容卡片的薄纱感由 base/sunken 提供(2026-09-13 用户实测修正)。
 */
const VEILED_TOKENS: ReadonlyArray<{ key: string; opacity: number }> = [
  { key: "--tmd-bg-base", opacity: 18 },
  { key: "--tmd-bg-sunken", opacity: 30 },
  /* composer 等主面板面:值随 elevated,45% 薄纱(旧 elevated 打穿浓度)。 */
  { key: "--tmd-bg-panel", opacity: 45 },
  /* hover 原值不透明(#242424):不打穿会成壁纸上的实心色块。 */
  { key: "--tmd-bg-hover", opacity: 65 },
  { key: "--tmd-bg-input", opacity: 70 },
  { key: "--tmd-terminal-bg", opacity: 45 },
];

/** 壁纸层基础 wash:主题底色 12% 罩在壁纸上,给薄纱 chrome 上的文字垫对比
 * (codemoss ::after wash 同款;用户侧另有 darken 滑杆加暗)。 */
const WASH_TOKEN = "--tmd-wallpaper-wash";
const WASH_OPACITY = 12;

/** terminal-bg 的最终覆盖样式(xterm 可解析的 rgba 字面量)。 */
export function terminalVeil(orig: string, opacity: number): string | null {
  const rgba = parseCssColor(orig);
  return rgba ? `rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, ${opacity / 100})` : null;
}

type Rgba = { r: number; g: number; b: number };

/** 解析主题 token 色值:#rgb / #rrggbb / #rrggbbaa / rgb() / rgba();不识别返回 null。 */
export function parseCssColor(input: string): Rgba | null {
  const value = input.trim();
  if (value.startsWith("#")) {
    const hex = value.slice(1);
    if (hex.length === 3) {
      const [r, g, b] = hex.split("").map((c) => parseInt(c + c, 16));
      return validRgb(r, g, b);
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return validRgb(r, g, b);
    }
    return null;
  }
  const match = value.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (!match) return null;
  return validRgb(Number(match[1]), Number(match[2]), Number(match[3]));
}

function validRgb(r: number, g: number, b: number): Rgba | null {
  if ([r, g, b].some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return null;
  return { r, g, b };
}

let active = false;
let applied = false;
const originals = new Map<string, string>();

function snapshotAndApply(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const styles = getComputedStyle(root);
  originals.clear();
  for (const { key, opacity } of VEILED_TOKENS) {
    const orig = styles.getPropertyValue(key).trim();
    if (!orig) continue;
    originals.set(key, orig);
    if (key === "--tmd-terminal-bg") {
      const veil = terminalVeil(orig, opacity);
      if (veil) root.style.setProperty(key, veil);
      /* 解析失败(非 hex/rgb 形态)保留原值:终端可读性优先于打穿。 */
      continue;
    }
    root.style.setProperty(key, `color-mix(in srgb, ${orig} ${opacity}%, transparent)`);
  }
  const baseOrig = originals.get("--tmd-bg-base");
  if (baseOrig) {
    root.style.setProperty(
      WASH_TOKEN,
      `color-mix(in srgb, ${baseOrig} ${WASH_OPACITY}%, transparent)`,
    );
  }
  applied = true;
}

function restore(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const [key, orig] of originals) root.style.setProperty(key, orig);
  originals.clear();
  root.style.removeProperty(WASH_TOKEN);
  applied = false;
}

/**
 * 应用/撤销打穿。幂等:重复同向调用不重拍快照(快照必须在「无覆盖」状态下取,
 * 否则会把 color-mix 结果当原色拍进去)。
 */
export function applyWallpaperPunch(next: boolean): void {
  if (typeof document === "undefined") return;
  if (next) {
    active = true;
    if (!applied) {
      snapshotAndApply();
      /* 活幕布的 xterm theme 是挂载期快照,打穿改了 --tmd-terminal-bg 要喊一声重读。 */
      notifyTerminalThemeChanged();
    }
    return;
  }
  active = false;
  restore();
  notifyTerminalThemeChanged();
}

/** 主题重应用后刷新:theme.ts 已整批抹掉覆盖,重拍快照安全。无壁纸激活则空转。 */
export function refreshWallpaperPunch(): void {
  if (!active) return;
  snapshotAndApply();
}

/** 主题跟随接线(背景层挂载期调用;返回退订)。 */
export function wireWallpaperThemeFollow(): () => void {
  return subscribeThemeApplied(() => refreshWallpaperPunch());
}
