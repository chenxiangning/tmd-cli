/**
 * 打开方式(open-with)跨插件契约 —— 预设目录 + 解析/展示纯函数 + 扩展名默认
 * 记忆覆盖层 + 图标懒提取缓存。
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
interface OpenWithPreset {
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

/* ── 按文件类型记忆默认打开方式(扩展名 → targetId 覆盖层)──
 * 纯 UI 态,localStorage 持久化即可、不进 settings schema(对齐 filePanel
 * 钉住清单先例);解析时校验目标仍在清单,被删的目标记忆自然失效。 */
const EXT_DEFAULT_KEY = "tmd.openWith.extDefault.v1";
const EXT_DEFAULT_MAX = 256;

function readExtDefaults(): Record<string, string> {
  if (typeof localStorage === "undefined") return {};
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(EXT_DEFAULT_KEY) ?? "{}");
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** 取路径扩展名(小写不含点;无扩展名与「.gitignore」型首点隐藏文件返回 null)。 */
export function openWithExt(path: string): string | null {
  const base = path.split("/").pop()?.split("\\").pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return null;
  const ext = base.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,16}$/.test(ext) ? ext : null;
}

/** 记忆「该扩展名用此目标打开」;满 256 条按插入序逐出最旧。写失败(隐私模式等)
 *  仅本次不记忆,打开动作不受影响。 */
export function rememberOpenWithDefault(path: string, targetId: string): void {
  const ext = openWithExt(path);
  if (!ext || typeof localStorage === "undefined") return;
  const map = readExtDefaults();
  delete map[ext]; // 重写 = 刷新插入序
  map[ext] = targetId;
  const keys = Object.keys(map);
  for (const k of keys.slice(0, Math.max(0, keys.length - EXT_DEFAULT_MAX))) delete map[k];
  try {
    localStorage.setItem(EXT_DEFAULT_KEY, JSON.stringify(map));
  } catch {
    /* 存储不可用:静默放弃记忆 */
  }
}

/** 带文件路径的默认项解析:扩展名记忆命中且目标仍在清单则优先,否则回落全局默认。 */
export function resolveDefaultOpenWithFor(
  targets: OpenWithTarget[],
  defaultId: string,
  path: string,
): OpenWithTarget | null {
  const ext = openWithExt(path);
  if (ext) {
    const remembered = readExtDefaults()[ext];
    const hit = remembered ? targets.find((x) => x.id === remembered) : undefined;
    if (hit) return hit;
  }
  return resolveDefaultOpenWith(targets, defaultId);
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
