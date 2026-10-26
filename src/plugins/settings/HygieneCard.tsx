/**
 * 会话卫生清扫设置卡 —— BehaviorTab 拆出(300 行铁则),样式全复用
 * pref-card/pref-row/segmented 现有类,零新增 CSS。
 * 语义:超期(默认 24h 无活动)会话自动转归档 + 其中空会话物理删除;
 * 清扫挂磁盘扫描结算点(零轮询),spec 见
 * docs/superpowers/specs/2026-09-19-session-hygiene-auto-archive-design.md。
 */

import {
  SESSION_HYGIENE_HOURS,
  SESSION_LOG_RETENTION_DAYS,
  updateSettings,
  useSettingsState,
  type SessionHygieneHours,
  type SessionLogRetentionDays,
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

/** 会话日志保留显示文案(0 = 不自动清理)。 */
const LOG_RETENTION_LABELS: Record<SessionLogRetentionDays, string> = {
  7: "7 天",
  30: "30 天",
  90: "90 天",
  0: "不清理",
};

export function HygieneCard() {
  const { settings } = useSettingsState();
  return (
    <div className="pref-card" data-testid="settings-hygiene-card">
      <div className="pref-row">
        <div>
          <div className="pref-title">{t("会话自动清理")}</div>
          <div className="pref-desc">
            {t("超过设定时长没有活动的会话自动转入归档;其中从未发过消息的空会话直接删除。工作区展开或手动刷新时执行,不后台轮询。")}
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
            {t("开")}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={!settings.sessionHygieneEnabled}
            className={`segment${!settings.sessionHygieneEnabled ? " is-active" : ""}`}
            onClick={() => updateSettings({ sessionHygieneEnabled: false })}
          >
            {t("关")}
          </button>
        </div>
      </div>
      {settings.sessionHygieneEnabled ? (
        <>
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
          {/* 上次清扫回执与手动清扫:清扫结算点在 workspace 磁盘扫描内部
              (sweepStaleSessions 需全量磁盘会话与活会话身份,设置卡无法独立
              触发),且结果不落盘、无统计可读 —— 按审计预案落说明文案。 */}
          <div className="pref-row">
            <div>
              <div className="pref-desc">{t("清扫随会话磁盘扫描自动进行(展开工作区或手动刷新即触发),暂无独立的手动清扫入口与上次清扫回执。")}</div>
            </div>
          </div>
        </>
      ) : null}
      {/* 会话输出日志保留(Rust session_log_sweep 消费):崩溃/强退残留的
          死日志按 mtime TTL 启动清理;0 = 关闭。手动入口在存储管家清理面。 */}
      <div className="pref-row">
        <div>
          <div className="pref-title">{t("会话输出日志保留")}</div>
          <div className="pref-desc">
            {t("应用异常退出会残留会话输出日志;超过保留天数的旧日志在启动时自动清理,使用中的会话不受影响。")}
          </div>
        </div>
        <StyledSelect
          value={String(settings.sessionLogRetentionDays)}
          ariaLabel={t("会话输出日志保留")}
          onChange={(v) =>
            updateSettings({ sessionLogRetentionDays: Number(v) as SessionLogRetentionDays })
          }
          options={SESSION_LOG_RETENTION_DAYS.map((d) => ({
            value: String(d),
            label: t(LOG_RETENTION_LABELS[d]),
          }))}
        />
      </div>
    </div>
  );
}
