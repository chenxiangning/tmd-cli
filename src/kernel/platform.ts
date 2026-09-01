/**
 * 平台探测 ─ UA 先行(同步、首帧可用),unknown 时经 ipc.platformKind 取 Rust 真实 OS 兜底。
 * - macOS: 检测到 "Mac OS X" ─ titlebar 走 overlay style(系统 traffic lights)
 * - Windows/Linux: 走 React 自绘 traffic lights
 *
 * 为什么必须有兜底:Windows 上 decorations=false,窗口控制按钮全靠 React 自绘;
 * UA 探测一旦异常,窗口只剩 Alt+F4 可关。
 */

import { useEffect, useState } from "react";
import { platformKind } from "@kernel/ipc";

export type PlatformKind = "macos" | "windows" | "linux" | "unknown";

let cached: PlatformKind | null = null;

function detectFromNavigator(): PlatformKind {
  if (typeof navigator === "undefined") return "unknown";
  const ua = (navigator.userAgent || "").toLowerCase();
  if (ua.includes("mac os x")) return "macos";
  if (ua.includes("windows")) return "windows";
  if (ua.includes("linux")) return "linux";
  return "unknown";
}

export function getPlatformKind(): PlatformKind {
  if (!cached) cached = detectFromNavigator();
  return cached;
}

/** Rust std::env::consts::OS → PlatformKind;不认识的系统归 unknown。 */
function normalizeOs(os: string): PlatformKind {
  return os === "macos" || os === "windows" || os === "linux" ? os : "unknown";
}

export function usePlatformKind(): PlatformKind {
  const [kind, setKind] = useState<PlatformKind>(() => getPlatformKind());
  useEffect(() => {
    if (getPlatformKind() !== "unknown") return;
    platformKind()
      .then((os) => {
        const resolved = normalizeOs(os);
        if (resolved !== "unknown") {
          cached = resolved;
          setKind(resolved);
        }
      })
      .catch(() => undefined);
  }, []);
  return kind;
}
