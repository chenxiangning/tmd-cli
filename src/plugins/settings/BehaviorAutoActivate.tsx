/**
 * 基础设置 / 行为 tab —— 启动自动激活最近会话分区(自 BehaviorTab 拆出,文件规模铁则)。
 *
 * 两个数字输入(blur/Enter 提交,先例会话输出缓冲上限):
 * - 天数窗口:0–30,默认 2;0 = 关闭(关闭时上限行隐藏)。
 * - 总数硬上限:1–32,默认 8;每个预激活都是一个真实 CLI 常驻进程。
 * 本地校验后写入,kernel/settings sanitize 兜底;样式复用 pref-row,零新增 CSS。
 */

import { updateSettings, useSettingsState } from "@kernel/settings";
import { t } from "@kernel/i18n";

export function BehaviorAutoActivate() {
  const { settings } = useSettingsState();
  const cfg = settings.autoActivateSessions;

  const commitDays = (raw: string) => {
    const n = Number.parseInt(raw, 10);
    if (Number.isInteger(n) && n >= 0 && n <= 30) {
      updateSettings({ autoActivateSessions: { ...cfg, days: n } });
    }
  };
  const commitMax = (raw: string) => {
    const n = Number.parseInt(raw, 10);
    if (Number.isInteger(n) && n >= 1 && n <= 32) {
      updateSettings({ autoActivateSessions: { ...cfg, max: n } });
    }
  };

  return (
    <>
      <div className="pref-row">
        <div>
          <div className="pref-title">{t("启动时自动激活会话")}</div>
          <div className="pref-desc">
            {t("重新打开应用时，后台预激活最近 N 天内有活动的会话（0 = 关闭）。预激活的会话点开即达，无需等待启动；每个会话都是一个真实进程，请配合上限使用。")}
          </div>
        </div>
        <input
          key={cfg.days}
          type="number"
          min={0}
          max={30}
          step={1}
          defaultValue={cfg.days}
          aria-label={t("自动激活天数窗口")}
          onBlur={(e) => commitDays(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitDays((e.target as HTMLInputElement).value);
          }}
          className="w-20 shrink-0 rounded-md border border-(--tmd-border) bg-(--tmd-bg-input) px-2 py-1 text-right text-sm text-(--tmd-fg) outline-none"
        />
      </div>
      {cfg.days > 0 ? (
        <div className="pref-row">
          <div>
            <div className="pref-title">{t("自动激活总数上限")}</div>
            <div className="pref-desc">
              {t("预激活的进程总数硬上限（1–32，默认 8）。超出后只保留各分组里最近的会话。")}
            </div>
          </div>
          <input
            key={cfg.max}
            type="number"
            min={1}
            max={32}
            step={1}
            defaultValue={cfg.max}
            aria-label={t("自动激活总数上限")}
            onBlur={(e) => commitMax(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitMax((e.target as HTMLInputElement).value);
            }}
            className="w-20 shrink-0 rounded-md border border-(--tmd-border) bg-(--tmd-bg-input) px-2 py-1 text-right text-sm text-(--tmd-fg) outline-none"
          />
        </div>
      ) : null}
    </>
  );
}
