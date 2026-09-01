/**
 * 基础设置 / 行为 tab —— 发送快捷键(复刻参考截图)。
 *
 * segmented 两选项:
 * - Enter 发送(默认,Shift+Enter 换行)
 * - ⌘/Ctrl+Enter 发送(Enter 换行)
 * 写入 kernel/settings store 的 sendShortcut 字段,Composer 即时生效,无需保存按钮。
 * 样式全部复用 pref-card/pref-row/segmented 现有类,零新增 CSS。
 */

import {
  updateSettings,
  useSettingsState,
  type SendShortcut,
} from "@kernel/settings";

const SEND_SHORTCUT_OPTIONS: ReadonlyArray<{
  id: SendShortcut;
  label: string;
}> = [
  { id: "enter", label: "Enter 发送" },
  { id: "cmdOrCtrlEnter", label: "⌘/Ctrl+Enter 发送" },
];

export function BehaviorTab() {
  const { settings } = useSettingsState();

  return (
    <div className="pref-card" data-testid="settings-behavior-card">
      <div className="pref-row">
        <div>
          <div className="pref-title">发送快捷键</div>
          <div className="pref-desc">选择消息发送与换行的按键行为。</div>
        </div>
        <div className="segmented" role="radiogroup" aria-label="发送快捷键">
          {SEND_SHORTCUT_OPTIONS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={settings.sendShortcut === id}
              className={`segment${settings.sendShortcut === id ? " is-active" : ""}`}
              onClick={() => updateSettings({ sendShortcut: id })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
