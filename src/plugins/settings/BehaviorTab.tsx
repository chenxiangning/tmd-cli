/**
 * 基础设置 / 行为 tab —— 发送快捷键 + 会话输出缓冲上限 + Ask 提示音。
 *
 * segmented 两选项:
 * - Enter 发送(默认,Shift+Enter 换行)
 * - ⌘/Ctrl+Enter 发送(Enter 换行)
 * 缓冲上限:数字输入,blur/Enter 提交,合法域 5万–1000万 字符(kernel/settings sanitize 兜底)。
 * 写入 kernel/settings store 即时生效,无需保存按钮。
 * 样式全部复用 pref-card/pref-row/segmented 现有类,零新增 CSS。
 */

import {
  ASK_SOUND_IDS,
  updateSettings,
  useSettingsState,
  type AskSoundId,
  type SendShortcut,
} from "@kernel/settings";
import { playAskSound } from "@kernel/askSound";

const SEND_SHORTCUT_OPTIONS: ReadonlyArray<{
  id: SendShortcut;
  label: string;
}> = [
  { id: "enter", label: "Enter 发送" },
  { id: "cmdOrCtrlEnter", label: "⌘/Ctrl+Enter 发送" },
];

/** 音效显示名(静态字面量表,Record 直查)。 */
const ASK_SOUND_LABELS: Record<AskSoundId, string> = {
  default: "默认",
  chime: "风铃",
  bell: "铃声",
  ding: "叮咚",
};

const ASK_SOUND_OPTIONS: ReadonlyArray<{ id: AskSoundId; label: string }> =
  ASK_SOUND_IDS.map((id) => ({ id, label: ASK_SOUND_LABELS[id] }));

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
      <div className="pref-row">
        <div>
          <div className="pref-title">Ask 提示音</div>
          <div className="pref-desc">
            CLI 弹出提问/权限确认面板时播放提示音，离开屏幕也能第一时间知道。
          </div>
        </div>
        <div className="segmented" role="radiogroup" aria-label="Ask 提示音">
          <button
            type="button"
            role="radio"
            aria-checked={settings.askSoundEnabled}
            className={`segment${settings.askSoundEnabled ? " is-active" : ""}`}
            onClick={() => updateSettings({ askSoundEnabled: true })}
          >
            开启
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={!settings.askSoundEnabled}
            className={`segment${!settings.askSoundEnabled ? " is-active" : ""}`}
            onClick={() => updateSettings({ askSoundEnabled: false })}
          >
            关闭
          </button>
        </div>
      </div>
      {settings.askSoundEnabled ? (
        <div className="pref-row">
          <div>
            <div className="pref-title">提示音</div>
            <div className="pref-desc">选择 Ask 提示音音效，「测试」立即试听。</div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <select
              value={settings.askSoundId}
              aria-label="提示音音效"
              onChange={(e) =>
                updateSettings({ askSoundId: e.target.value as AskSoundId })
              }
              className="rounded-md border border-(--tmd-border) bg-(--tmd-bg-input) px-2 py-1 text-sm text-(--tmd-fg) outline-none"
            >
              {ASK_SOUND_OPTIONS.map(({ id, label }) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="segment is-active"
              onClick={() => playAskSound(settings.askSoundId)}
            >
              测试
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
