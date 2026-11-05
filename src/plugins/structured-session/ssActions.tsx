/** 结构化会话头部工作流动作：批次深链、blocks 接力、上一回合预览回填。 */
import { useEffect, useState } from "react";
import type { EditorTab } from "@kernel/tabs";
import { DialogActions, DialogShell } from "@kernel/DialogShell";
import { t } from "@kernel/i18n";
import { getWorkspaces } from "@kernel/workspace";
import { ArrowSquareOut, ClockCounterClockwise, SealCheck } from "@phosphor-icons/react";
import { openBatchTab } from "@plugins/checkpoints/batchTab";
import { getCkptBatches, refreshBatches } from "@plugins/checkpoints/store";
import { relayOpenRef } from "@kernel/relayBridge";
import { host } from "@kernel/host";
import type { SsSessionState } from "./ssSession";
import type { StructuredSessionPayload } from "@kernel/structuredSessionTabs";
import { lastRetryablePrompt } from "./retryPrompt";

function RetryDialog(props: {
  ss: SsSessionState;
  payload: StructuredSessionPayload;
  ledgerId: string;
  title: string;
  prompt: string;
  onClose: () => void;
}) {
  const { ss, payload, ledgerId, prompt } = props;
  const [batch, setBatch] = useState<{ id: string; index: number } | null>(null);
  useEffect(() => {
    let alive = true;
    if (!ss.sessionId) return;
    void refreshBatches(payload.cwd, ss.sessionId, ledgerId).then(() => {
      if (!alive) return;
      const batches = getCkptBatches(payload.cwd, ss.sessionId).batches;
      const hit = batches.find((b) => b.prompt === prompt || (b.prompt.length > 0 && prompt.startsWith(b.prompt)));
      if (hit) setBatch({ id: hit.id, index: hit.index });
    });
    return () => { alive = false; };
  }, [payload.cwd, ss.sessionId, ledgerId, prompt]);

  const openBatch = () => {
    if (!batch || !ss.sessionId) return;
    openBatchTab({
      cwd: payload.cwd,
      sessionId: ss.sessionId,
      tmdSessionId: ledgerId,
      batchId: batch.id,
      title: t("批次 #{index}", { index: batch.index }),
    });
    props.onClose();
  };
  return (
    <DialogShell
      title={t("重试上一回合")}
      icon={<ClockCounterClockwise size="1rem" aria-hidden />}
      onClose={props.onClose}
      footer={<DialogActions confirmLabel={t("回填输入框")} onCancel={props.onClose} onConfirm={() => {
        ss.setDraft(prompt);
        props.onClose();
      }} />}
    >
      <div className="mt-3 text-xs text-(--tmd-fg-muted)">{t("目标会话:{title}", { title: props.title })}</div>
      <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded border border-(--tmd-border) bg-(--tmd-bg-base) p-3 font-[inherit] text-sm">{prompt}</pre>
      <div className="mt-2 flex items-center justify-between gap-3 text-xs text-(--tmd-fg-muted)">
        <span>{t("仅回填，不会自动发送")}</span>
        {batch ? <button type="button" className="text-(--tmd-accent) hover:underline" onClick={openBatch}>{t("对应 checkpoint 批次")}</button> : null}
      </div>
    </DialogShell>
  );
}

export function SsActions({ ss, payload, tab }: { ss: SsSessionState; payload: StructuredSessionPayload; tab: EditorTab }) {
  const [retryPrompt, setRetryPrompt] = useState<string | null>(null);
  const lastPrompt = lastRetryablePrompt(ss.blocks);
  const openLatestBatch = async () => {
    if (!ss.sessionId) return;
    const sessionId = ss.sessionId;
    await refreshBatches(payload.cwd, sessionId, tab.id);
    const batch = getCkptBatches(payload.cwd, sessionId).batches[0];
    if (!batch) return;
    openBatchTab({
      cwd: payload.cwd,
      sessionId,
      tmdSessionId: tab.id,
      batchId: batch.id,
      title: t("批次 #{index}", { index: batch.index }),
    });
  };
  const relay = () => {
    relayOpenRef.current?.({
      profileId: payload.profileId,
      engineName: host.getCliProfile(payload.profileId)?.name ?? payload.profileId,
      cliSessionId: ss.sessionId ?? undefined,
      title: tab.title,
      model: ss.model?.id ?? null,
      cwd: payload.cwd,
      workspaceId: getWorkspaces().find((w) => payload.cwd === w.root || payload.cwd.startsWith(`${w.root}/`))?.id,
      blocks: ss.blocks,
    });
  };
  return (
    <>
      <button type="button" className="ss-pill-btn" title={t("批次")} aria-label={t("批次")} disabled={!ss.sessionId} onClick={() => void openLatestBatch()}>
        <SealCheck size="0.8rem" aria-hidden />
      </button>
      <button type="button" className="ss-pill-btn" title={t("接力")} aria-label={t("接力")} disabled={!relayOpenRef.current} onClick={relay}>
        <ArrowSquareOut size="0.8rem" aria-hidden />
      </button>
      <button type="button" className="ss-pill-btn" title={t("重试上一回合…")} aria-label={t("重试上一回合…")} disabled={!lastPrompt} onClick={() => setRetryPrompt(lastPrompt)}>
        <ClockCounterClockwise size="0.8rem" aria-hidden />
      </button>
      {retryPrompt ? <RetryDialog ss={ss} payload={payload} ledgerId={tab.id} title={tab.title} prompt={retryPrompt} onClose={() => setRetryPrompt(null)} /> : null}
    </>
  );
}
