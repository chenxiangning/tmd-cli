/**
 * 打开方式(open-with)跨插件契约 —— 预设目录 + 解析/展示纯函数 + 图标懒提取缓存。
 * settings 插件(基础设置「打开方式」面板)与 files 插件(文件底部菜单)共同消费;
 * 类型本体在 settingsTypes(OpenWithTarget),启动/探测/图标命令见 kernel/ipc(Rust open_with.rs)。
 * 图标组件本体在 OpenWithIcon.tsx(本文件保持纯逻辑)。
 * 复刻 mossx:预设目录 + 懒探测,可用性不持久化;图标 = OS 提取(mem 缓存)→ 通用图标兜底。
 */

import { useEffect, useState } from "react";
import { t } from "./i18n";
import type { OpenWithTarget } from "./settingsTypes";
import { ipc } from "./ipc";

export type OpenWithPlatform = "macos" | "windows" | "linux";

/** 宿主平台探测(UA;桌面 webview 三平台够用,异常回落 linux 宽集)。 */
export function detectOpenWithPlatform(ua = typeof navigator === "undefined" ? "" : navigator.userAgent): OpenWithPlatform {
  if (ua.includes("Mac")) return "macos";
  if (ua.includes("Win")) return "windows";
  return "linux";
}

/** 预设目录条目:探测独立进行,未安装灰显;不含运行时状态。 */
export interface OpenWithPreset {
  /** 与目标 id 同域:已添加判定 = targets.some(t => t.id === preset.id)。 */
  id: string;
  label: string;
  kind: OpenWithTarget["kind"];
  appName?: string;
  command?: string;
  platforms: OpenWithPlatform[];
}

/** 精选预设(复刻 mossx 精简,非全系统枚举);finder 恒可用、跨平台。 */
export const OPEN_WITH_PRESET_CATALOG: OpenWithPreset[] = [
  { id: "finder", label: "访达", kind: "finder", platforms: ["macos", "windows", "linux"] },
  { id: "vscode", label: "VS Code", kind: "app", appName: "Visual Studio Code", platforms: ["macos", "windows", "linux"] },
  { id: "cursor", label: "Cursor", kind: "app", appName: "Cursor", platforms: ["macos", "windows", "linux"] },
  { id: "zed", label: "Zed", kind: "app", appName: "Zed", platforms: ["macos", "windows", "linux"] },
  { id: "sublime", label: "Sublime Text", kind: "app", appName: "Sublime Text", platforms: ["macos", "windows", "linux"] },
  { id: "ghostty", label: "Ghostty", kind: "app", appName: "Ghostty", platforms: ["macos", "linux"] },
  { id: "antigravity", label: "Antigravity", kind: "app", appName: "Antigravity", platforms: ["macos", "windows", "linux"] },
  { id: "notepad", label: "Notepad", kind: "app", appName: "notepad", platforms: ["windows"] },
  { id: "windows-terminal", label: "Windows Terminal", kind: "command", command: "wt.exe", platforms: ["windows"] },
];

/** 默认项解析:defaultId 失效(被删/手改 JSON)回落首项;清单空返回 null(入口隐藏)。 */
export function resolveDefaultOpenWith(targets: OpenWithTarget[], defaultId: string): OpenWithTarget | null {
  if (targets.length === 0) return null;
  return targets.find((t) => t.id === defaultId) ?? targets[0];
}

/** 设置面板副行文案:app → `应用 · appName`;command → `命令 · command`;finder → 固定「访达」。 */
export function openWithSubtitle(target: OpenWithTarget): string {
  if (target.kind === "app") return `${t("应用")} · ${target.appName ?? ""}`;
  if (target.kind === "command") return `${t("命令")} · ${target.command ?? ""}`;
  return t("访达");
}

/** 预设 → 目标条目(添加对话框用);自定义(浏览)条目见 customOpenWithTarget。 */
export function openWithTargetFromPreset(preset: OpenWithPreset): OpenWithTarget {
  const base: OpenWithTarget = { id: preset.id, label: preset.label, kind: preset.kind };
  if (preset.appName !== undefined) base.appName = preset.appName;
  if (preset.command !== undefined) base.command = preset.command;
  return base;
}

/** 浏览选中的应用 → 自定义目标(label 取文件名,appName = 选中路径)。 */
export function customOpenWithTarget(path: string): OpenWithTarget {
  const label = path.split("/").pop()?.split("\\").pop()?.replace(/\.app$/i, "") || path;
  return { id: `custom-${Date.now().toString(36)}`, label, kind: "app", appName: path };
}

/* ── 图标懒提取(mem 缓存;失败也缓存,防重复 invoke)── */

const iconCache = new Map<string, Promise<string | null>>();

function loadIcon(appName: string): Promise<string | null> {
  let p = iconCache.get(appName);
  if (!p) {
    p = ipc.fsOpenAppIcon(appName).catch(() => null);
    iconCache.set(appName, p);
  }
  return p;
}

/** 应用图标 data URL(OS 懒提取);null = 未提取/失败,调用方渲染通用图标。 */
export function useOpenWithIcon(appName: string | null): string | null {
  const [icon, setIcon] = useState<string | null>(null);
  useEffect(() => {
    if (!appName) {
      setIcon(null);
      return;
    }
    let alive = true;
    void loadIcon(appName).then((dataUrl) => {
      if (alive) setIcon(dataUrl);
    });
    return () => {
      alive = false;
    };
  }, [appName]);
  return icon;
}
