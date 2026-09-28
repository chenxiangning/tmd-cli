/**
 * 意图画布 · 编辑器共享件(移植自 mossx IntentCanvasEditor 头部工具区)。
 * 主题跟随:tmd-cli 主题引擎(resolveEffectiveAppearance)+ 设置订阅,替代
 * mossx 的 data-attribute MutationObserver。
 */

import { useEffect, useState } from "react";
import { getSettingsState, subscribeSettings } from "@kernel/settings";
import { resolveEffectiveAppearance } from "@kernel/theme";
import type { IntentCanvasDocument } from "../types";
import type { IntentCanvasSourceLocation } from "../utils/traceability";

export function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type IntentCanvasOpenSourceFile = (
  path: string,
  location?: IntentCanvasSourceLocation,
) => void;

export type IntentCanvasEditorProps = {
  document: IntentCanvasDocument;
  activeThreadId: string | null;
  isSaving: boolean;
  onBack: () => void;
  onSave: (document: IntentCanvasDocument) => Promise<IntentCanvasDocument>;
  onAttachToThread?: (document: IntentCanvasDocument) => Promise<void> | void;
  onOpenProjectMap?: () => void;
  onOpenSourceFile?: IntentCanvasOpenSourceFile;
  managerErrorMessage?: string | null;
}

/* Intl formatter 模块级复用(状态栏/卡片时间热路径)。 */
const EDITOR_DATETIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function formatDateTime(value: string): string {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) {
    return value;
  }
  return EDITOR_DATETIME_FORMATTER.format(time);
}

function parseMultilineLinks(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/\r?\n|,/g)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function linksToText(values: string[]): string {
  return values.join("\n");
}

function systemDarkNow(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

function currentAppearance(): "light" | "dark" {
  try {
    return resolveEffectiveAppearance(getSettingsState().settings, systemDarkNow());
  } catch {
    return "light";
  }
}

/** 画布明暗 = 应用生效外观;设置变更即时跟随,system 模式挂系统监听。 */
function useCanvasTheme(): "light" | "dark" {
  const [theme, setTheme] = useState<"light" | "dark">(currentAppearance);

  useEffect(() => {
    const unsubSettings = subscribeSettings(() => setTheme(currentAppearance()));
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const onSystemChange = () => setTheme(currentAppearance());
    media?.addEventListener?.("change", onSystemChange);
    return () => {
      unsubSettings();
      media?.removeEventListener?.("change", onSystemChange);
    };
  }, []);

  return theme;
}

/** excalidraw 内建 UI 语言:跟随 tmd-cli 界面语言设置。 */
function excalidrawLangCode(): "zh-CN" | "en" {
  try {
    /* mossx 口径:非中文一律 en(excalidraw 无 ja 语言包)。 */
    return getSettingsState().settings.language === "zh" ? "zh-CN" : "en";
  } catch {
    return "zh-CN";
  }
}

export {
  formatDateTime,
  parseMultilineLinks,
  linksToText,
  useCanvasTheme,
  excalidrawLangCode,
};
