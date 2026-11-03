/** 历史回合预览:候选 + 原文 + 原轮批次入口;确认仅回填 composer。 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowClockwise } from "@phosphor-icons/react";
import { errTextDisplay } from "@kernel/errText";
import { t } from "@kernel/i18n";
import { useFocusTrap } from "@kernel/useFocusTrap";
import { openBatchTab } from "../checkpoints/batchTab";
import { confirmRetry, loadRetryTurns, type RetryTurnPreview, type RetrySource } from "./retry";
import { clearRetrySource, useRetrySource } from "./relayStore";

export function RetryLayer() {
  const source = useRetrySource();
  if (!source) return null;
  return <RetryDialog source={source} onClose={clearRetrySource} />;
}

function RetryDialog({ source, onClose }: { source: RetrySource; onClose: () => void }) {
  const dialogRef = useFocusTrap(true);
  const [loading, setLoading] = useState(true);
  const [turns, setTurns] = useState<RetryTurnPreview[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const aliveRef = useRef(true);
  const previewRequestRef = useRef(0);
  const preview = turns.find((turn) => turn.id === selectedId) ?? null;

  useEffect(() => {
    aliveRef.current = true;
    const request = ++previewRequestRef.current;
    const current = () => aliveRef.current && request === previewRequestRef.current;
    setLoading(true);
    setError("");
    setTurns([]);
    setSelectedId("");
    void loadRetryTurns(source)
      .then((next) => {
        if (!current()) return;
        setTurns(next);
        setSelectedId(next[0]?.id ?? "");
      })
      .catch((e: unknown) => { if (current()) setError(errTextDisplay(e)); })
      .finally(() => { if (current()) setLoading(false); });
    return () => {
      aliveRef.current = false;
    };
  }, [source]);

  const retry = async (): Promise<void> => {
    if (busy || !preview) return;
    setBusy(true);
    setError("");
    try {
      await confirmRetry(source, preview.text);
      onClose();
    } catch (e) {
      if (aliveRef.current) setError(errTextDisplay(e));
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  };

  /* 用户关闭受忙碌守卫;confirmRetry 成功路径直接 onClose,保证正常收框。 */
  const closeGuarded = () => {
    if (!busy) onClose();
  };

  return createPortal(
    <div
      role="presentation"
      className="fixed inset-0 z-[1201] flex items-start justify-center overflow-y-auto bg-black/45 p-4 pt-[12vh]"
      data-icon-decor="dialog"
      onClick={(e) => e.target === e.currentTarget && closeGuarded()}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.nativeEvent.isComposing) closeGuarded();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-busy={busy}
        aria-label={t("重试历史回合")}
        className="flex max-h-[76vh] w-[460px] max-w-[calc(100vw-2rem)] flex-col gap-3 overflow-y-auto rounded-xl border border-(--tmd-border) bg-(--tmd-bg-panel) p-4 shadow-(--tmd-shadow-modal)"
      >
        <div className="text-sm font-medium text-(--tmd-fg)">{t("重试历史回合")}</div>
        <div className="text-xs text-(--tmd-fg-faint)">
          {t("目标会话:{title} · {engine}", { title: source.title ?? source.cliSessionId ?? source.engineName, engine: source.engineName })}
        </div>
        {loading ? (
          <div className="py-6 text-center text-xs text-(--tmd-fg-faint)">{t("读取上一回合…")}</div>
        ) : preview ? (
          <>
            <select
              value={selectedId}
              disabled={busy}
              aria-label={t("选择重试回合")}
              onChange={(event) => setSelectedId(event.target.value)}
              className="w-full rounded-md border border-(--tmd-border) bg-(--tmd-bg-input) px-2 py-1.5 text-xs text-(--tmd-fg) focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--tmd-accent)"
            >
              {turns.map((turn) => {
                const summary = turn.text.trim().replace(/\s+/g, " ");
                const label = summary.length > 48 ? `${summary.slice(0, 48)}…` : summary;
                return <option key={turn.id} value={turn.id}>{t("回合 #{index}", { index: turn.index })} · {label}</option>;
              })}
            </select>
            <textarea
              readOnly
              value={preview.text}
              rows={9}
              aria-label={t("上一回合原文")}
              className="w-full resize-none rounded-md border border-(--tmd-border) bg-(--tmd-bg-input) p-2 text-xs leading-4 text-(--tmd-fg) outline-none"
            />
          </>
        ) : (
          <div className="py-6 text-center text-xs text-(--tmd-fg-faint)">{t("没有可重试的用户消息")}</div>
        )}
        {error && <div role="alert" className="text-xs text-(--tmd-danger, #e5484d)">{error}</div>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            {preview?.batch && (
              <button
                type="button"
                disabled={busy}
                className="rounded-md border border-(--tmd-border) px-3 py-1.5 text-xs text-(--tmd-fg-faint) hover:text-(--tmd-fg) disabled:opacity-50"
                onClick={() => {
                  openBatchTab({
                    cwd: source.cwd,
                    sessionId: source.cliSessionId!,
                    tmdSessionId: source.sessionId,
                    batchId: preview.batch!.id,
                    title: t("批次 #{index}", { index: preview.batch!.index }),
                  });
                  onClose();
                }}
              >
                {t("对应 checkpoint 批次 #{index}", { index: preview.batch.index })}
              </button>
            )}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={closeGuarded}
              className="rounded-md border border-(--tmd-border) px-3 py-1.5 text-xs text-(--tmd-fg-faint) hover:text-(--tmd-fg) disabled:opacity-50"
            >
              {preview ? t("取消") : t("关闭")}
            </button>
            {preview && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void retry()}
                className="inline-flex items-center gap-1.5 rounded-md bg-(--tmd-accent) px-3 py-1.5 text-xs text-white disabled:opacity-50"
              >
                <ArrowClockwise size="0.75rem" aria-hidden />
                {busy ? t("回填中…") : t("回填到输入框")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
