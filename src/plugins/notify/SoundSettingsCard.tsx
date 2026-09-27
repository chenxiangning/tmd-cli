/**
 * 系统通知 / 提示音卡 —— 自基础设置·行为 tab 迁入(Ask 提示音/音效/音量/
 * 结束提示音/后台提醒)。卡头说明 + 6 行;读写 kernel/settings store 即时生效,
 * 试听走 kernel/askSound.playAskSound,样式复用 pref-card/pref-row/segmented。
 */

import {
  ASK_SOUND_IDS,
  updateSettings,
  useSettingsState,
  type AskSoundId,
} from "@kernel/settings";
import { playAskSound } from "@kernel/askSound";
import { t } from "@kernel/i18n";
import { StyledSelect } from "@kernel/StyledSelect";

/** 音效显示名(静态字面量表,Record 直查)。 */
const ASK_SOUND_LABELS: Record<AskSoundId, string> = {
  default: "默认",
  chime: "风铃",
  bell: "铃声",
  ding: "叮咚",
};

const ASK_SOUND_OPTIONS: ReadonlyArray<{ id: AskSoundId; label: string }> =
  ASK_SOUND_IDS.map((id) => ({ id, label: ASK_SOUND_LABELS[id] }));

/** 二选一 segmented(开启/关闭),形态与全库设置行一致;NotifySettingsTab 复用。 */
export function ToggleRow(props: {
  title: string;
  desc: string;
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className="pref-row">
      <div>
        <div className="pref-title">{props.title}</div>
        <div className="pref-desc">{props.desc}</div>
      </div>
      <div className="segmented" role="radiogroup" aria-label={props.title}>
        <button
          type="button"
          role="radio"
          aria-checked={props.on}
          className={`segment${props.on ? " is-active" : ""}`}
          onClick={() => props.onChange(true)}
        >
          {t("开启")}
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={!props.on}
          className={`segment${!props.on ? " is-active" : ""}`}
          onClick={() => props.onChange(false)}
        >
          {t("关闭")}
        </button>
      </div>
    </div>
  );
}

export function SoundSettingsCard() {
  const { settings } = useSettingsState();

  return (
    <div className="pref-card" data-testid="settings-sound-card">
      <div className="pref-row">
        <div>
          <div className="pref-title">{t("提示音")}</div>
          <div className="pref-desc">{t("应用内音效,不受窗口焦点影响;两类音共用下方音量。")}</div>
        </div>
      </div>
      <ToggleRow
        title={t("Ask 提示音")}
        desc={t("CLI 弹出提问/权限确认面板时播放提示音，离开屏幕也能第一时间知道。")}
        on={settings.askSoundEnabled}
        onChange={(on) => updateSettings({ askSoundEnabled: on })}
      />
      {settings.askSoundEnabled ? (
        <div className="pref-row">
          <div>
            <div className="pref-title">{t("提示音")}</div>
            <div className="pref-desc">{t("选择 Ask 提示音音效，「试听」立即播放。")}</div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <StyledSelect
              value={settings.askSoundId}
              ariaLabel={t("提示音音效")}
              onChange={(v) => updateSettings({ askSoundId: v as AskSoundId })}
              options={ASK_SOUND_OPTIONS.map(({ id, label }) => ({ value: id, label: t(label) }))}
            />
            <button
              type="button"
              className="segment is-active"
              onClick={() => playAskSound(settings.askSoundId)}
            >
              {t("试听")}
            </button>
          </div>
        </div>
      ) : null}
      <div className="pref-row">
        <div>
          <div className="pref-title">{t("提示音音量")}</div>
          <div className="pref-desc">{t("作用于 Ask 提示音与结束提示音。")}</div>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.1}
          value={settings.soundVolume}
          aria-label={t("提示音音量")}
          onChange={(e) => updateSettings({ soundVolume: Number(e.target.value) })}
          className="w-28 shrink-0 accent-(--tmd-accent)"
        />
      </div>
      <ToggleRow
        title={t("结束提示音")}
        desc={t("一轮对话结束且未被查看时播放（结算后静默 3 秒确认，中途来新输出不响）。")}
        on={settings.turnEndSoundEnabled}
        onChange={(on) => updateSettings({ turnEndSoundEnabled: on })}
      />
      {settings.turnEndSoundEnabled ? (
        <div className="pref-row">
          <div>
            <div className="pref-title">{t("结束音效")}</div>
            <div className="pref-desc">{t("选择轮次结束提示音音效，「试听」立即播放。")}</div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <StyledSelect
              value={settings.turnEndSoundId}
              ariaLabel={t("结束音效")}
              onChange={(v) => updateSettings({ turnEndSoundId: v as AskSoundId })}
              options={ASK_SOUND_OPTIONS.map(({ id, label }) => ({ value: id, label: t(label) }))}
            />
            <button
              type="button"
              className="segment is-active"
              onClick={() => playAskSound(settings.turnEndSoundId)}
            >
              {t("试听")}
            </button>
          </div>
        </div>
      ) : null}
      <ToggleRow
        title={t("后台提醒")}
        desc={t("窗口失焦时，当前会话完成一轮对话也标记未读并播放结束提示音；切回窗口即恢复已读。")}
        on={settings.backgroundNotify}
        onChange={(on) => updateSettings({ backgroundNotify: on })}
      />
    </div>
  );
}
