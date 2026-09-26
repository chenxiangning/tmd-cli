/**
 * 接力对话框 ── 目标引擎单选 + 摘要预览(可编辑)+ 确认开新会话。
 * 数据:当前激活会话 → 源信息与用户消息(经 profile 声明的读取器);
 * 动作:createSession(目标引擎,同 cwd/工作区)→ writeSession(摘要)。
 */

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { PaperPlaneRight } from "@phosphor-icons/react";
import { host } from "@kernel/host";
import { getActiveWorkspace } from "@kernel/workspace";
import { t } from "@kernel/i18n";
import { relayTargets, buildRelaySummary, type RelaySource } from "./relay";

export function RelayDialog({ source, onClose }: { source: RelaySource; onClose: () => void }) {
  const workspace = getActiveWorkspace();
  const targets = useMemo(
    () => relayTargets(host.getCliProfiles(), source.profileId),
    [source.profileId],
  );
  const [targetId, setTargetId] = useState<string | null>(targets[0]?.id ?? null);
  const [summary, setSummary] = useState("");
  const [summaryReady, setSummaryReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  /* 摘要一次性组装:读源会话用户消息(全量),取最近 N 条确定性拼接。 */
  useEffect(() => {
    let alive = true;
    const reader = source.cliSessionId
      ? host.getCliProfile(source.profileId)?.readSessionUserMessages
      : undefined;
    const load = reader && source.cliSessionId && source.cliSessionId !== "unknown"
      ? reader(workspace?.root ?? "", source.cliSessionId, true)
      : Promise.resolve(null);
    void load
      .then((messages) => {
        if (alive) {
          setSummary(buildRelaySummary(source, messages ?? []));
          setSummaryReady(true);
        }
      })
      .catch(() => {
        if (alive) {
          setSummary(buildRelaySummary(source, []));
          setSummaryReady(true);
        }
      });
    return () => {
      alive = false;
    };
    // source 由打开方构造后不变,workspace 根在浮层生命周期内亦不变
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const relay = async (): Promise<void> => {
    if (!targetId || !workspace || busy || !summaryReady) return;
    setBusy(true);
    setError("");
    try {
      const meta = await host.createSession(targetId, workspace.root, workspace.id);
      if (summary.trim()) {
        const ok = await host.writeSession(meta.id, `${summary.trim()}\n`);
        if (!ok) {
          /* 目标会话秒退/写入失败:提示词凭空消失比失败更糟,留框让用户重试 */
          setError(t("接力提示词未能送达(目标会话可能已退出),请重试或取消"));
          setBusy(false);
          return;
        }
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return createPortal(
    <div
      role="presentation"
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/45"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex w-[460px] flex-col gap-3 rounded-xl border border-(--tmd-border) bg-(--tmd-bg-panel) p-4 shadow-2xl">
        <div className="text-sm font-medium text-(--tmd-fg)">{t("转到其他引擎接力")}</div>

        <div>
          <div className="mb-1 text-xs text-(--tmd-fg-faint)">{t("目标引擎")}</div>
          <div className="flex flex-wrap gap-1.5">
            {targets.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setTargetId(p.id)}
                aria-pressed={targetId === p.id}
                className={`rounded-md border px-2 py-1 text-xs ${
                  targetId === p.id
                    ? "border-(--tmd-accent) bg-(--tmd-accent)/10 text-(--tmd-fg)"
                    : "border-(--tmd-border) text-(--tmd-fg-faint) hover:text-(--tmd-fg)"
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        <div className="flex min-h-0 flex-col">
          <div className="mb-1 text-xs text-(--tmd-fg-faint)">
            {t("接力提示词(可编辑,将作为新会话首条消息发出)")}
          </div>
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={10}
            className="w-full resize-none rounded-md border border-(--tmd-border) bg-(--tmd-bg-input) p-2 text-xs leading-4 text-(--tmd-fg) outline-none focus:border-(--tmd-accent)"
            aria-label={t("接力提示词")}
          />
        </div>

        {error && <div className="text-xs text-(--tmd-danger, #e5484d)">{error}</div>}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-(--tmd-border) px-3 py-1.5 text-xs text-(--tmd-fg-faint) hover:text-(--tmd-fg)"
          >
            {t("取消")}
          </button>
          <button
            type="button"
            disabled={!targetId || busy || !summaryReady}
            onClick={() => void relay()}
            className="flex items-center gap-1.5 rounded-md bg-(--tmd-accent) px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            <PaperPlaneRight size="0.75rem" aria-hidden />
            {busy ? t("开新会话中…") : summaryReady ? t("开新会话并发送") : t("摘要生成中…")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
