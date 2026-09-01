import { host, useHost } from "@kernel/host";
import { QuotaChip } from "./QuotaChip";

export function ComposerToolbar() {
  useHost();
  const sessionId = host.getActiveSessionId();
  const status = sessionId ? host.getSessionStatus(sessionId) : undefined;

  return (
    <div className="flex h-7 shrink-0 items-center gap-2 border-b border-(--tmd-border) px-2 text-[11px] leading-none text-(--tmd-fg-muted) select-none">
      <span className="flex items-center gap-1" title={status?.model ?? "未识别模型"}>
        <span aria-hidden>模型</span>
        <span className="font-mono text-(--tmd-fg)">{status?.model ?? "—"}</span>
      </span>
      <span aria-hidden className="text-(--tmd-fg-faint)">|</span>
      <span className="flex items-center gap-1" title={status?.thinkingLevel ?? "未识别思考强度"}>
        <span aria-hidden>思考</span>
        <span className="font-mono text-(--tmd-fg)">{status?.thinkingLevel ?? "—"}</span>
      </span>
      {sessionId ? (
        <>
          <span aria-hidden className="text-(--tmd-fg-faint)">|</span>
          <QuotaChip />
        </>
      ) : null}
      <span className="ml-auto text-[10px] text-(--tmd-fg-faint)">只读</span>
    </div>
  );
}
