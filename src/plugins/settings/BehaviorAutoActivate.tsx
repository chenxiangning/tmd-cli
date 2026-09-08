/**
 * 行为页「启动时自动激活会话」卡片。
 *
 * 三个数字输入(blur/Enter 提交,先例会话输出缓冲上限):
 * - 天数窗口:0–30,默认 1;0 = 关闭(关闭时其余两行隐藏)。
 * - 每组预载条数:1–8,默认 1;每个 工作区×CLI 组按时间序取最新 N 条,组的第一条必中。
 * - 总数硬上限:1–32,默认 16;每个预激活都是一个真实 CLI 常驻进程。
 * 本地校验后写入,kernel/settings sanitize 兜底;样式复用 pref-row,零新增 CSS。
 */
import { useState } from "react";
import { t } from "@kernel/i18n";
import { getSettingsState, updateSettings } from "@kernel/settings";
import { AUTO_ACTIVATE_DAYS_MAX, AUTO_ACTIVATE_MAX_LIMIT, AUTO_ACTIVATE_PER_GROUP_LIMIT } from "@kernel/settingsTypes";

function clampInt(raw: string, min: number, max: number): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

export function BehaviorAutoActivate() {
  const cfg = getSettingsState().settings.autoActivateSessions;
  const [draft, setDraft] = useState({
    days: String(cfg.days),
    perGroup: String(cfg.perGroup),
    max: String(cfg.max),
  });
  const commit = (key: "days" | "perGroup" | "max", min: number, max: number) => {
    const n = clampInt(draft[key], min, max);
    if (n === null || n === cfg[key]) {
      setDraft({ ...draft, [key]: String(cfg[key]) });
      return;
    }
    updateSettings({ autoActivateSessions: { ...cfg, [key]: n } });
  };
  const inputCls =
    "w-16 rounded-md border border-(--tmd-border) bg-(--tmd-bg) px-2 py-1 text-right text-xs outline-none focus:border-(--tmd-accent)";
  return (
    <div className="pref-cluster">
      <div className="pref-row">
        <div>
          <div className="pref-title">{t("启动时自动激活会话")}</div>
          <div className="pref-desc">
            {t("重新打开应用时，后台预激活最近 N 天内有活动的会话（0 = 关闭）。预激活的会话点开即达，无需等待启动；每个会话都是一个真实进程，请配合上限使用。")}
          </div>
        </div>
        <input
          className={inputCls}
          type="number"
          min={0}
          max={AUTO_ACTIVATE_DAYS_MAX}
          value={draft.days}
          onChange={(e) => setDraft({ ...draft, days: e.target.value })}
          onBlur={() => commit("days", 0, AUTO_ACTIVATE_DAYS_MAX)}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
      </div>
      {cfg.days > 0 && (
        <>
          <div className="pref-row">
            <div>
              <div className="pref-title">{t("每组预载条数")}</div>
              <div className="pref-desc">
                {t("每个 工作区×CLI 组按时间序预载的最新条数（1–8，默认 1）。设为 1 可保证每组的最新一条点击秒开。")}
              </div>
            </div>
            <input
              className={inputCls}
              type="number"
              min={1}
              max={AUTO_ACTIVATE_PER_GROUP_LIMIT}
              value={draft.perGroup}
              onChange={(e) => setDraft({ ...draft, perGroup: e.target.value })}
              onBlur={() => commit("perGroup", 1, AUTO_ACTIVATE_PER_GROUP_LIMIT)}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            />
          </div>
          <div className="pref-row">
            <div>
              <div className="pref-title">{t("自动激活总数上限")}</div>
              <div className="pref-desc">
                {t("预激活的进程总数硬上限（1–32，默认 16）。超出后按时间降序只保留最近的会话。")}
              </div>
            </div>
            <input
              className={inputCls}
              type="number"
              min={1}
              max={AUTO_ACTIVATE_MAX_LIMIT}
              value={draft.max}
              onChange={(e) => setDraft({ ...draft, max: e.target.value })}
              onBlur={() => commit("max", 1, AUTO_ACTIVATE_MAX_LIMIT)}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            />
          </div>
        </>
      )}
    </div>
  );
}
