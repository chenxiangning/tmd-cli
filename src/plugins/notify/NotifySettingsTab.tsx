/**
 * notify 设置页 ── 三类通知开关 + 额度预警阈值。
 * 开关复刻 BehaviorTab 的 segmented 形态;阈值 = 数字输入(0 = 关)。
 */

import { useSettingsState, updateSettings } from "@kernel/settings";
import { t } from "@kernel/i18n";

/** 整数钳制提交:空/非法回落默认 10,越界钳到 0-100。 */
function commitThreshold(raw: string): void {
  const n = Number.parseInt(raw, 10);
  const value = Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 10;
  updateSettings({ notifyQuotaWarnPercent: value });
}

export function NotifySettingsTab() {
  const { settings } = useSettingsState();

  const toggles = [
    {
      key: "notifyOsAsk" as const,
      title: t("Ask 等待确认"),
      desc: t("CLI 弹出提问/权限确认面板时发系统通知,离开窗口也能第一时间知道。"),
    },
    {
      key: "notifyOsTurnEnd" as const,
      title: t("轮次结束"),
      desc: t("会话完成一轮且未被查看时发系统通知。"),
    },
    {
      key: "notifyOsSessionExit" as const,
      title: t("会话退出"),
      desc: t("CLI 进程退出时发系统通知;高频且常是自己关的,默认关。"),
    },
  ];

  return (
    <div className="flex flex-col gap-4 p-4">
      {toggles.map((item) => (
        <div key={item.key} className="pref-row">
          <div>
            <div className="pref-title">{item.title}</div>
            <div className="pref-desc">{item.desc}</div>
          </div>
          <div className="segmented" role="radiogroup" aria-label={item.title}>
            <button
              type="button"
              role="radio"
              aria-checked={settings[item.key]}
              className={`segment${settings[item.key] ? " is-active" : ""}`}
              onClick={() => updateSettings({ [item.key]: true })}
            >
              {t("开启")}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={!settings[item.key]}
              className={`segment${!settings[item.key] ? " is-active" : ""}`}
              onClick={() => updateSettings({ [item.key]: false })}
            >
              {t("关闭")}
            </button>
          </div>
        </div>
      ))}

      <div className="pref-row">
        <div>
          <div className="pref-title">{t("额度撞墙预警")}</div>
          <div className="pref-desc">
            {t("激活会话供应商每 10 分钟查一次额度,窗口已用百分比达到阈值即发系统通知(同一窗口周期只提醒一次);0 = 关。")}
          </div>
        </div>
        <input
          type="number"
          min={0}
          max={100}
          step={5}
          defaultValue={settings.notifyQuotaWarnPercent}
          key={settings.notifyQuotaWarnPercent}
          onBlur={(e) => commitThreshold(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitThreshold((e.target as HTMLInputElement).value);
          }}
          aria-label={t("额度预警阈值百分比")}
          className="w-20 shrink-0 rounded-md border border-(--tmd-border) bg-(--tmd-bg-input) px-2 py-1 text-right text-sm text-(--tmd-fg) outline-none"
        />
      </div>
    </div>
  );
}
