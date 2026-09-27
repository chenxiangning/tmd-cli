/**
 * notify 设置页 ── 三卡编排:桌面通知(OS 级开关)/ 提示音(应用内音效,
 * SoundSettingsCard)/ 额度撞墙预警(阈值)。
 * 每卡 = pref-card + 卡头(pref-row 形态的分组标题 + 一句说明,无右侧控件)
 * + 设置行;与 BehaviorTab/HygieneCard 同款间距(pref-card margin-top),
 * 零新增 CSS。纯 UI 编排:读写 kernel/settings store 即时生效。
 */

import { useSettingsState, updateSettings } from "@kernel/settings";
import { t } from "@kernel/i18n";
import { SoundSettingsCard, ToggleRow } from "./SoundSettingsCard";

/** 整数钳制提交:空/非法回落默认 10,越界钳到 0-100。 */
function commitThreshold(raw: string): void {
  const n = Number.parseInt(raw, 10);
  const value = Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 10;
  updateSettings({ notifyQuotaWarnPercent: value });
}

/** 卡头:分组标题 + 一句说明(占一个 pref-row 的左列,右侧无控件)。 */
function CardHead(props: { title: string; desc: string }) {
  return (
    <div className="pref-row">
      <div>
        <div className="pref-title">{props.title}</div>
        <div className="pref-desc">{props.desc}</div>
      </div>
    </div>
  );
}

export function NotifySettingsTab() {
  const { settings } = useSettingsState();

  const osToggles = [
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
    <>
      <div className="pref-card" data-testid="settings-os-notify-card">
        <CardHead
          title={t("桌面通知")}
          desc={t("窗口失焦时才发系统级通知;回到窗口即静默,不与界面内的红点/标签重复打扰。")}
        />
        {osToggles.map((item) => (
          <ToggleRow
            key={item.key}
            title={item.title}
            desc={item.desc}
            on={settings[item.key]}
            onChange={(on) => updateSettings({ [item.key]: on })}
          />
        ))}
      </div>

      <SoundSettingsCard />

      <div className="pref-card" data-testid="settings-quota-alert-card">
        <CardHead
          title={t("额度撞墙预警")}
          desc={t("供应商额度逼近上限的提前提醒;仅窗口失焦时发送,聚焦时看额度 chip 即可。")}
        />
        <div className="pref-row">
          <div>
            <div className="pref-title">{t("预警阈值")}</div>
            <div className="pref-desc">
              {t("每 10 分钟查一次激活会话供应商的额度,窗口已用百分比达到阈值即发通知(同一窗口周期只提醒一次);0 = 关。")}
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
    </>
  );
}
