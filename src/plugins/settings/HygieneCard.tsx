/**
 * 会话卫生清扫设置卡 —— BehaviorTab 拆出(300 行铁则),样式全复用
 * pref-card/pref-row/segmented 现有类,零新增 CSS。
 * 语义:超期(默认 24h 无活动)会话自动转归档 + 其中空会话物理删除;
 * 清扫挂磁盘扫描结算点(零轮询),spec 见
 * docs/superpowers/specs/2026-09-19-session-hygiene-auto-archive-design.md。
 */

import {
  SESSION_HYGIENE_HOURS,
  updateSettings,
  useSettingsState,
  type SessionHygieneHours,
} from "@kernel/settings";
import { t } from "@kernel/i18n";
import { StyledSelect } from "@kernel/StyledSelect";

/** 时窗显示文案(白名单序直查;168 显示为 7 天)。 */
const HYGIENE_HOURS_LABELS: Record<SessionHygieneHours, string> = {
  12: "12 小时",
  24: "24 小时",
  48: "48 小时",
  168: "7 天",
};

export function HygieneCard() {
  const { settings } = useSettingsState();
  return (
    <div className="pref-card" data-testid="settings-hygiene-card">
      <div className="pref-row">
        <div>
          <div className="pref-title">{t("会话自动清理")}</div>
          <div className="pref-desc">
            {t("超过设定时长没有活动的会话自动转入归档；其中从未发过消息的空会话直接删除。工作区展开或手动刷新时执行，不后台轮询。")}
          </div>
        </div>
        <div className="segmented" role="radiogroup" aria-label={t("会话自动清理")}>
          <button
            type="button"
            role="radio"
            aria-checked={settings.sessionHygieneEnabled}
            className={`segment${settings.sessionHygieneEnabled ? " is-active" : ""}`}
            onClick={() => updateSettings({ sessionHygieneEnabled: true })}
          >
            {t("开启")}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={!settings.sessionHygieneEnabled}
            className={`segment${!settings.sessionHygieneEnabled ? " is-active" : ""}`}
            onClick={() => updateSettings({ sessionHygieneEnabled: false })}
          >
            {t("关闭")}
          </button>
        </div>
      </div>
      {settings.sessionHygieneEnabled ? (
        <div className="pref-row">
          <div>
            <div className="pref-title">{t("超期时长")}</div>
            <div className="pref-desc">{t("以会话最后活动时间计算；置顶与手动恢复过的会话不清理。")}</div>
          </div>
          <StyledSelect
            value={String(settings.sessionHygieneHours)}
            ariaLabel={t("超期时长")}
            onChange={(v) => updateSettings({ sessionHygieneHours: Number(v) as SessionHygieneHours })}
            options={SESSION_HYGIENE_HOURS.map((h) => ({ value: String(h), label: t(HYGIENE_HOURS_LABELS[h]) }))}
          />
        </div>
      ) : null}
    </div>
  );
}
