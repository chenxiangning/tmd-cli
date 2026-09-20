/**
 * 打开方式清单清洗 —— settingsSanitize 卫星模块(主文件 300 行铁则,
 * 惯例同 settingsSanitizeWorkspace / settingsSanitizeSessions)。
 */

import type { OpenWithTarget } from "./settingsTypes";
import { DEFAULT_SETTINGS } from "./settingsDefaults";

/** 打开方式 kind 白名单。 */
const OPEN_WITH_KINDS: readonly OpenWithTarget["kind"][] = ["app", "command", "finder"];
/** 打开方式清单条目上限(手改 JSON 兜底,防膨胀;设置面板添加按钮同用)。 */
export const OPEN_WITH_TARGETS_MAX = 32;

/**
 * 打开方式清单清洗:仅留结构合法条目(非空 id/label + 白名单 kind + 按 kind 配套字段),
 * args 收窄为非空字符串数组;确定性保序,超限截断。
 */
export function sanitizeOpenWithTargets(raw: unknown): OpenWithTarget[] {
  /* 深拷贝回落:DEFAULT_SETTINGS 是模块级单例,直接给活引用会被未来
     就地变更腐蚀全局默认。 */
  if (!Array.isArray(raw)) return DEFAULT_SETTINGS.openWithTargets.map((x) => ({ ...x }));
  const out: OpenWithTarget[] = [];
  for (const item of raw.slice(0, OPEN_WITH_TARGETS_MAX)) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const id = typeof rec.id === "string" ? rec.id.trim().slice(0, 64) : "";
    const label = typeof rec.label === "string" ? rec.label.trim().slice(0, 60) : "";
    if (id === "" || label === "" || !OPEN_WITH_KINDS.includes(rec.kind as OpenWithTarget["kind"])) {
      continue;
    }
    const kind = rec.kind as OpenWithTarget["kind"];
    const args = Array.isArray(rec.args)
      ? rec.args
          .filter((a): a is string => typeof a === "string" && a.trim() !== "")
          .slice(0, 8)
      : [];
    if (kind === "app") {
      const appName = typeof rec.appName === "string" ? rec.appName.trim().slice(0, 500) : "";
      if (appName === "") continue;
      out.push(args.length > 0 ? { id, label, kind, appName, args } : { id, label, kind, appName });
    } else if (kind === "command") {
      const command = typeof rec.command === "string" ? rec.command.trim().slice(0, 500) : "";
      if (command === "") continue;
      out.push(args.length > 0 ? { id, label, kind, command, args } : { id, label, kind, command });
    } else {
      out.push({ id, label, kind: "finder" });
    }
  }
  return out;
}
