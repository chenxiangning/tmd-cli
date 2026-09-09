/**
 * 快捷键 tab 右栏:详情面板 + 录制区 —— ShortcutTab 拆出的交互半区(300 行铁则)。
 *
 * 录制流:点击录制区 → `setShortcutRecording(true)` 开分发器闸门 → window capture 接管
 * 一次 keydown;成功 → `updateSettings({ shortcutOverrides })`(settings 内部 sanitize 并
 * 喂入覆盖层,无需二次 setShortcutOverrides);失败 → 行内红字保持录制态继续录;
 * Esc 取消 / Backspace 解绑;60s 超时经 onTimeout 同步退出录制态。
 */
import { useEffect, useState } from "react";
import type { CommandContribution } from "@kernel/shortcuts";
import {
  formatKeyEvent,
  getShortcutOverridesSnapshot,
  isShortcutRemappable,
  setShortcutRecording,
  validateOverride,
} from "@kernel/shortcutOverrides";
import { t } from "@kernel/i18n";
import { updateSettings } from "@kernel/settings";
import { effectiveLabel } from "./ShortcutList";

/** 大键帽(详情面板录制态显示区)。 */
function BigKeyCap({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-[6px] border border-(--tmd-border-strong) bg-(--tmd-bg-input) px-3 py-2 font-mono text-[0.875rem] text-(--tmd-fg)">
      {label}
    </span>
  );
}

/** 录制区:点击进入录制态;录制期接管一次 keydown capture;
 *  成功 → updateSettings;失败 → 行内红字并保持录制态继续录;
 *  Esc/Backspace 退出 / 解绑。 */
function Recorder({
  cmd,
  error,
  setError,
}: {
  cmd: CommandContribution;
  error: string | null;
  setError: (e: string | null) => void;
}) {
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    if (!recording) return;
    // 60s 超时:闸门自闭 + 本组件同步退出录制态(防一键两吃)
    setShortcutRecording(true, () => setRecording(false));
    setError(null);
    const onKey = (e: KeyboardEvent) => {
      // Esc 退出
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        setRecording(false);
        return;
      }
      // Backspace/Delete 解绑
      if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        e.stopImmediatePropagation();
        const overrides = { ...getShortcutOverridesSnapshot() };
        overrides[cmd.id] = "";
        updateSettings({ shortcutOverrides: overrides });
        setError(null);
        setRecording(false);
        return;
      }
      // 其它键一律 preventDefault,避免触发既有快捷键(虽然分发器已闸门)
      e.preventDefault();
      e.stopImmediatePropagation();
      const value = formatKeyEvent({
        key: e.key,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
      });
      if (!value) return; // 无修饰键或非法键:静默继续录
      const result = validateOverride(cmd.id, value);
      if (!result.ok) {
        const reasonText: Record<typeof result.reason, string> = {
          "escape-forbidden": t("Escape 不可绑定"),
          "missing-modifier": t("需含 ⌘/Ctrl/Shift/Alt 之一"),
          syntax: t("键位格式错误"),
          conflict: t("与 {id} 占用,无法使用", { id: result.detail ?? "" }),
        };
        setError(reasonText[result.reason]);
        return;
      }
      const overrides = { ...getShortcutOverridesSnapshot(), [cmd.id]: value };
      updateSettings({ shortcutOverrides: overrides });
      setError(null);
      setRecording(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      setShortcutRecording(false);
    };
  }, [recording, cmd.id, setError]);

  const remappable = isShortcutRemappable(cmd.id);
  const label = effectiveLabel(cmd);

  return (
    <div>
      <button
        type="button"
        data-testid={`shortcut-recorder-${cmd.id}`}
        onClick={() => setRecording(true)}
        disabled={!remappable || recording}
        className={`shortcut-recorder${recording ? " is-recording" : ""}${
          !remappable ? " is-disabled" : ""
        }`}
      >
        {recording ? (
          <span className="shortcut-recorder-prompt">{t("录制中…")}</span>
        ) : remappable ? (
          <span className="shortcut-recorder-prompt">{t("点击录制新的快捷键")}</span>
        ) : (
          <span className="shortcut-recorder-prompt">{t("此命令为内置键位,不可改")}</span>
        )}
      </button>
      {recording ? (
        <p className="mt-1 text-[0.6875rem] text-(--tmd-fg-muted)">
          {t("按 Esc 取消 · Backspace 解绑")}
        </p>
      ) : null}
      {error ? (
        <p
          data-testid={`shortcut-recorder-error-${cmd.id}`}
          className="mt-1 text-[0.6875rem] text-(--tmd-err)"
        >
          {error}
        </p>
      ) : null}
      {label ? <BigKeyCap label={label} /> : null}
    </div>
  );
}

/** 右侧详情面板(选中命令名 + 大键帽 + 描述 + 录制区 + 重置)。 */
export function DetailPanel({
  cmd,
  onReset,
}: {
  cmd: CommandContribution;
  onReset: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  // 切命令时清错
  useEffect(() => setError(null), [cmd.id]);
  const hasOverride = cmd.id in getShortcutOverridesSnapshot();
  return (
    <div className="pref-card sticky top-0 flex flex-col gap-3 p-4" data-testid={`shortcut-detail-${cmd.id}`}>
      <div>
        <div className="pref-title">{t(cmd.title)}</div>
        <div className="text-[0.6875rem] text-(--tmd-fg-faint) font-mono">{cmd.id}</div>
      </div>
      <Recorder cmd={cmd} error={error} setError={setError} />
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid={`shortcut-reset-${cmd.id}`}
          onClick={onReset}
          disabled={!hasOverride}
          className="shortcut-reset"
        >
          {t("恢复默认")}
        </button>
      </div>
    </div>
  );
}
