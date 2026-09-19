/**
 * 打开方式目标图标(跨插件共享组件;逻辑与 hook 在 kernel/openWith.ts)。
 * OS 提取 data URL 优先;无提取通道(finder/command/失败)回落语义图标。
 */

import { AppWindow, FolderSimple } from "@phosphor-icons/react";
import { useOpenWithIcon } from "./openWith";
import type { OpenWithTarget } from "./settingsTypes";

export function OpenWithIcon({ target, size = "1rem" }: { target: OpenWithTarget; size?: string }) {
  const icon = useOpenWithIcon(target.kind === "app" ? (target.appName ?? null) : null);
  if (icon) return <img src={icon} alt="" className="ow-icon" style={{ width: size, height: size }} />;
  if (target.kind === "finder") return <FolderSimple size={size} className="ow-icon-ph" aria-hidden />;
  return <AppWindow size={size} className="ow-icon-ph" aria-hidden />;
}
