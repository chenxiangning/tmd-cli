/**
 * 工作台设置分区页(设置页 · 工作台):目前只有文档详情默认视图一行。
 * 行形态与全库设置一致(pref-row + segmented,循 notify SoundSettingsCard);
 * 写 kernel/settings 即时生效,DocEditor 每次挂载重读。
 */

import { t } from "@kernel/i18n";
import { updateSettings, useSettingsState } from "@kernel/settings";
import type { WbDocDefaultMode } from "@kernel/settingsTypes";

const MODE_OPTIONS: ReadonlyArray<{ id: WbDocDefaultMode; label: string }> = [
  { id: "preview", label: "预览" },
  { id: "edit", label: "编辑" },
];

export function WorkbenchSettingsTab() {
  const { settings } = useSettingsState();
  const current = settings.workbenchDocDefaultMode;
  return (
    <div className="pref-card">
      <div className="pref-row">
        <div>
          <div className="pref-title">{t("文档默认视图")}</div>
          <div className="pref-desc">{t("打开文档详情时默认进入的模式。")}</div>
        </div>
        <div className="segmented" role="radiogroup" aria-label={t("文档默认视图")}>
          {MODE_OPTIONS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={current === id}
              className={`segment${current === id ? " is-active" : ""}`}
              onClick={() => updateSettings({ workbenchDocDefaultMode: id })}
            >
              {/* 渲染期 t():模块顶层固化语言违反 i18n 约定 */}
              {t(label)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
