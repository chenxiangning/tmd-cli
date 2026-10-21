/**
 * ports · 平台探测 —— userAgent 判 OS(Tauri webview UA 自带平台段)。
 * 零 IPC:Windows NT / Macintosh / X11 Linux 三段判定,Linux 兜底。
 */

import type { OsKind } from "./types";

export function detectOs(ua: string = navigator.userAgent): OsKind {
  if (/Windows NT|Windows Phone/i.test(ua)) return "windows";
  if (/Macintosh|Mac OS X/i.test(ua)) return "mac";
  return "linux";
}

/** 平台展示名(词典键)。 */
export const OS_LABEL: Record<OsKind, string> = {
  mac: "macOS",
  linux: "Linux",
  windows: "Windows",
};
