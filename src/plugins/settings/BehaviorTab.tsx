/**
 * 基础设置 / 行为 tab —— 发送快捷键 + 会话输出缓冲上限。
 *
 * segmented 两选项:
 * - Enter 发送(默认,Shift+Enter 换行)
 * - ⌘/Ctrl+Enter 发送(Enter 换行)
 * 缓冲上限:数字输入,blur/Enter 提交,合法域 5万–1000万 字符(kernel/settings sanitize 兜底)。
 * 写入 kernel/settings store 即时生效,无需保存按钮。
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

  const commitBufferLimit = (raw: string) => {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) updateSettings({ sessionOutputBufferLimit: n });
  };

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
      <div className="pref-row">
        <div>
          <div className="pref-title">会话输出缓冲上限</div>
          <div className="pref-desc">
            单会话保留的终端输出字符数（5万–1000万，默认 50
            万）。切回会话的回放深度由它决定；更早历史可在幕布顶部继续翻页加载。
          </div>
        </div>
        <input
          key={settings.sessionOutputBufferLimit}
          type="number"
          min={50_000}
          max={10_000_000}
          step={50_000}
          defaultValue={settings.sessionOutputBufferLimit}
          onBlur={(e) => commitBufferLimit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitBufferLimit((e.target as HTMLInputElement).value);
          }}
          className="w-32 shrink-0 rounded-md border border-(--tmd-border) bg-(--tmd-bg-input) px-2 py-1 text-right text-sm text-(--tmd-fg) outline-none"
        />
      </div>
    </div>
  );
}
