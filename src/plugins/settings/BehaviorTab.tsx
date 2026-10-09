/**
 * 基础设置 / 行为 tab —— 发送快捷键 + 输入历史(补全开关 + 管理区)+ 会话输出缓冲上限。
 * (Ask/结束提示音与后台提醒已迁至「系统通知」插件的设置页,见 plugins/notify/SoundSettingsCard。)
 *
 * segmented 两选项:
 * - Enter 发送(默认,Shift+Enter 换行)
 * - ⌘/Ctrl+Enter 发送(Enter 换行)
 * 输入历史(2026-09-10,参考 codemoss):「历史输入补全」开关写入 settings;
 * 「输入历史」折叠管理区在行为卡片下方(计数/逐条删/清空),组件 PromptHistoryManager。
 * 写入 kernel/settings store 即时生效,无需保存按钮。
 * 样式全部复用 pref-card/pref-row/segmented 现有类,零新增 CSS。
 */

import { useEffect, useState } from "react";
import {
  updateSettings,
  useSettingsState,
  type SendShortcut,
} from "@kernel/settings";
import { PromptHistoryManager } from "./PromptHistoryManager";
import { HygieneCard } from "./HygieneCard";
import { t } from "@kernel/i18n";
import {
  BUFFER_LIMIT_MAX,
  BUFFER_LIMIT_MIN,
  sanitizeBufferLimitInput,
} from "./behaviorCommit";

const SEND_SHORTCUT_OPTIONS: ReadonlyArray<{
  id: SendShortcut;
  label: string;
}> = [
  { id: "enter", label: "Enter 发送" },
  { id: "cmdOrCtrlEnter", label: "⌘/Ctrl+Enter 发送" },
];

export function BehaviorTab() {
  const { settings } = useSettingsState();
  /* 受控草稿:提交(含钳制/回落)后显示值与 store 同步,消「显示 2000 实际 50 万」。 */
  const [bufferDraft, setBufferDraft] = useState(String(settings.sessionOutputBufferLimit));
  useEffect(() => {
    setBufferDraft(String(settings.sessionOutputBufferLimit));
  }, [settings.sessionOutputBufferLimit]);
  /** 域外钳到最近边界(如 2000 → 5万),空/非法回落 store 当前值;显示随之同步。 */
  const commitBufferLimit = (raw: string) => {
    const next = sanitizeBufferLimitInput(raw, settings.sessionOutputBufferLimit);
    setBufferDraft(String(next));
    if (next !== settings.sessionOutputBufferLimit) {
      updateSettings({ sessionOutputBufferLimit: next });
    }
  };

  return (
    <>
    <div className="pref-card" data-testid="settings-behavior-card">
      <div className="pref-row">
        <div>
          <div className="pref-title">{t("发送快捷键")}</div>
          <div className="pref-desc">{t("选择消息发送与换行的按键行为。")}</div>
        </div>
        <div className="segmented" role="radiogroup" aria-label={t("发送快捷键")}>
          {SEND_SHORTCUT_OPTIONS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={settings.sendShortcut === id}
              className={`segment${settings.sendShortcut === id ? " is-active" : ""}`}
              onClick={() => updateSettings({ sendShortcut: id })}
            >
              {t(label)}
            </button>
          ))}
        </div>
      </div>
      <div className="pref-row">
        <div>
          <div className="pref-title">{t("发送二次确认")}</div>
          <div className="pref-desc">{t("发送前弹窗确认目标会话与内容预览,防平铺模式发错会话;Enter 确认,Esc 取消。")}</div>
        </div>
        <div className="segmented" role="radiogroup" aria-label={t("发送二次确认")}>
          <button
            type="button"
            role="radio"
            aria-checked={settings.sendConfirmEnabled}
            className={`segment${settings.sendConfirmEnabled ? " is-active" : ""}`}
            onClick={() => updateSettings({ sendConfirmEnabled: true })}
          >
            {t("开")}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={!settings.sendConfirmEnabled}
            className={`segment${!settings.sendConfirmEnabled ? " is-active" : ""}`}
            onClick={() => updateSettings({ sendConfirmEnabled: false })}
          >
            {t("关")}
          </button>
        </div>
      </div>
      <div className="pref-row">
        <div>
          <div className="pref-title">{t("历史输入补全")}</div>
          <div className="pref-desc">{t("输入时按 Tab 接受历史补全建议;输入框为空时按 ↑↓ 翻阅历史。")}</div>
        </div>
        <div className="segmented" role="radiogroup" aria-label={t("历史输入补全")}>
          <button
            type="button"
            role="radio"
            aria-checked={settings.promptHistoryEnabled}
            className={`segment${settings.promptHistoryEnabled ? " is-active" : ""}`}
            onClick={() => updateSettings({ promptHistoryEnabled: true })}
          >
            {t("开")}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={!settings.promptHistoryEnabled}
            className={`segment${!settings.promptHistoryEnabled ? " is-active" : ""}`}
            onClick={() => updateSettings({ promptHistoryEnabled: false })}
          >
            {t("关")}
          </button>
        </div>
      </div>
      <div className="pref-row">
        <div>
          <div className="pref-title">{t("会话输出缓冲上限")}</div>
          <div className="pref-desc">
            {t("单会话保留的终端输出字符数(5万–1000万,默认 50 万)。切回会话的回放深度由它决定;更早历史可在幕布顶部继续翻页加载。")}
          </div>
        </div>
        <input
          type="number"
          aria-label={t("会话输出缓冲上限")}
          min={BUFFER_LIMIT_MIN}
          max={BUFFER_LIMIT_MAX}
          step={50_000}
          value={bufferDraft}
          onChange={(e) => setBufferDraft(e.target.value)}
          onBlur={(e) => commitBufferLimit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitBufferLimit((e.target as HTMLInputElement).value);
          }}
          className="w-32 shrink-0 rounded-md border border-(--tmd-border) bg-(--tmd-bg-input) px-2 py-1 text-right text-sm text-(--tmd-fg) outline-none"
        />
      </div>
    </div>
      <PromptHistoryManager />
      <HygieneCard />
    </>
  );
}
