/**
 * Git 面板记忆态清洗(自 settingsSanitize.ts 拆出,文件规模铁则)。
 * 视图/布局/diff 模式白名单外的值逐项回落默认;bool 字段非 boolean 回落默认。
 */
import { DEFAULT_SETTINGS } from "./settingsDefaults";
import type { AppSettings } from "./settingsTypes";
import type { GitDiffMode, GitFileListLayout, GitPanelView } from "./settingsTypes";

const GIT_PANEL_VIEWS: readonly GitPanelView[] = ["diff", "branch", "history"];
const GIT_PANEL_LAYOUTS: readonly GitFileListLayout[] = ["flat", "tree"];
const GIT_DIFF_MODES: readonly GitDiffMode[] = ["unified", "split"];

/** 外部 JSON 收窄为索引面,逐字段白名单校验后才取值(同 sanitize() 主纪律)。 */
export function sanitizeGitPanel(raw: unknown): AppSettings["git"] {
  const d = DEFAULT_SETTINGS.git;
  if (!raw || typeof raw !== "object") return d;
  const rec = raw as Record<string, unknown>;
  return {
    view: GIT_PANEL_VIEWS.includes(rec.view as GitPanelView) ? (rec.view as GitPanelView) : d.view,
    layout: GIT_PANEL_LAYOUTS.includes(rec.layout as GitFileListLayout)
      ? (rec.layout as GitFileListLayout)
      : d.layout,
    diffMode: GIT_DIFF_MODES.includes(rec.diffMode as GitDiffMode)
      ? (rec.diffMode as GitDiffMode)
      : d.diffMode,
    diffWrap: typeof rec.diffWrap === "boolean" ? rec.diffWrap : d.diffWrap,
  };
}
