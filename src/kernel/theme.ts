/**
 * 主题引擎 —— 设置 → DOM 的唯一应用点。
 *
 * 职责:
 * 1. 解析外观:system 经 matchMedia 落到 light/dark;custom 取 preset 的 appearance。
 * 2. 应用:`<html data-theme>` + `data-theme-preset`(custom 时) + preset 派生的
 *    `--tmd-*` 内联变量(static CSS 只提供默认 light/dark,防启动闪色)。
 * 3. 跟随:订阅 settings store;system 模式下挂 prefers-color-scheme 监听。
 *
 * main.tsx 调 startThemeEngine() 启动,幂等。
 */

import {
  ensureSettingsBooted,
  getSettingsState,
  subscribeSettings,
  type AppSettings,
} from "./settings";
import { getThemePreset, type ThemeAppearance, type ThemePresetId } from "./themePresets";
import { mapPresetToTokens, THEME_CSS_VARIABLE_KEYS } from "./themeTokens";

/** 当前生效外观解析。导出供插件只读使用(如代码高亮选 light/dark 样式)。 */
export function resolveEffectiveAppearance(
  settings: Pick<AppSettings, "theme" | "customThemePresetId">,
  systemDark: boolean,
): ThemeAppearance {
  if (settings.theme === "custom") {
    return getThemePreset(settings.customThemePresetId).appearance;
  }
  if (settings.theme === "system") return systemDark ? "dark" : "light";
  return settings.theme;
}

/** 当前生效 preset:custom → customThemePresetId;否则按外观取 light/dark presetId。 */
function resolveActivePresetId(
  settings: AppSettings,
  appearance: ThemeAppearance,
): ThemePresetId {
  if (settings.theme === "custom") return settings.customThemePresetId;
  return appearance === "light" ? settings.lightThemePresetId : settings.darkThemePresetId;
}

function systemDarkNow(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

function applyTheme(settings: AppSettings): void {
  const root = document.documentElement;
  const appearance = resolveEffectiveAppearance(settings, systemDarkNow());
  const presetId = resolveActivePresetId(settings, appearance);

  root.dataset.theme = appearance;
  if (settings.theme === "custom") {
    root.dataset.themePreset = presetId;
  } else {
    delete root.dataset.themePreset;
  }

  // 全量内联:light/dark 走各自 presetId(默认即静态 CSS 同源色,幂等无害);
  // custom 由 preset 决定。先清旧值避免上一个 preset 的残留键。
  for (const key of THEME_CSS_VARIABLE_KEYS) root.style.removeProperty(key);
  const tokens = mapPresetToTokens(getThemePreset(presetId));
  for (const [key, value] of Object.entries(tokens)) root.style.setProperty(key, value);
  themeAppliedListeners.forEach((fn) => fn());
}

const themeAppliedListeners = new Set<() => void>();

/** 主题应用完成通知(命令式消费者,如 xterm 幕布重刷 theme)。返回退订函数。 */
export function subscribeThemeApplied(fn: () => void): () => void {
  themeAppliedListeners.add(fn);
  return () => themeAppliedListeners.delete(fn);
}

let started = false;

/** 启动主题引擎;幂等。依赖 settings boot 完成后的首次 emit 应用首屏主题。 */
export function startThemeEngine(): void {
  if (started) return;
  started = true;
  ensureSettingsBooted();

  let applied = false;
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", () => applyTheme(getSettingsState().settings));

  // 订阅 store(纯通知,不依赖 React 渲染):settings 加载完成/用户切换 → 重应用。
  subscribeSettings(() => {
    applyTheme(getSettingsState().settings);
    applied = true;
  });
  // 已加载完成的场景(热更新)直接应用一次。
  if (!applied && getSettingsState().loaded) {
    applyTheme(getSettingsState().settings);
  }
}
