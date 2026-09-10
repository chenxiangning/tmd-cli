/**
 * BatchRow —— 审批线时间线的批次行(CheckpointsPanel 拆分件,文件规模铁则)。
 *
 * 组成:批头(状态点 + prompt 摘要 + ±stats + 状态徽标 + 归因标记)→
 * 文件行(状态 chip + 路径 + ± + 深链审阅单)→ 批尾动作(通过/回退/应用/反悔)
 * → 内联确认卡(回退与应用共用,mode 区分文案与动作)。
 * 文件行与确认卡拆至 BatchRowParts.tsx;批头拆至 BatchRowHead.tsx(状态元表
 * batchStateMeta.ts),批尾动作留本文件(BatchActionBar/statusHint 降分支)。
 */

import { useEffect } from "react";
import { Check, ArrowCounterClockwise, ArrowUUpLeft, Lightning } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import type { CkptBatch } from "@kernel/ipc";
import { loadDiff, refreshOpenDiff } from "./store";
import { batchState, type BatchStateKey } from "./batchStateMeta";
import { BatchHeadButton } from "./BatchRowHead";
import { ConfirmCard, FileRow, type ConfirmTarget } from "./BatchRowParts";
export type { ConfirmTarget } from "./BatchRowParts";

const POLL_MS = 6000;

/** 批尾状态说明文案(no-high-complexity 降分支)。 */
function statusHint(st: BatchStateKey): string {
  if (st === "open") return t("进行中 —— 本轮对话结算后自动封口进入待审");
  if (st === "done") return t("已处理 —— 无需操作");
  if (st === "approved") return t("已通过 —— 仅标记,改动仍在工作区");
  if (st === "reverted") return t("已回退 · 恢复点留存");
  return t("回退前自动打恢复点");
}

/** 批尾动作:通过/回退整批/应用/反悔 + 状态说明文案(降分支拆件)。 */
function BatchActionBar({
  b,
  st,
  busy,
  setConfirm,
  onApprove,
  onUndo,
}: {
  b: CkptBatch;
  st: BatchStateKey;
  busy: boolean;
  setConfirm: (v: ConfirmTarget | null) => void;
  onApprove: (batchId: string) => Promise<void>;
  onUndo: (batchId: string) => Promise<void>;
}) {
  const revertable = b.files.filter((f) => f.live === "same" && !f.noBaseline);
  return (
    <div className="ml-4 mb-2 mt-0.5 flex items-center gap-1.5">
      {st === "pending" && (
        <button
          type="button"
          disabled={busy}
          className="flex h-[21px] flex-none items-center gap-1 rounded border border-(--tmd-diff-inserted)/40 px-2 text-[0.625rem] text-(--tmd-diff-inserted) hover:bg-(--tmd-diff-inserted)/10 disabled:opacity-40"
          title={t("标记本批已审阅(纯标记,不影响任何文件)")}
          onClick={() => void onApprove(b.id)}
        >
          <Check size="0.625rem" aria-hidden /> {t("通过")}
        </button>
      )}
      {(st === "pending" || st === "approved") && revertable.length > 0 && (
        <button
          type="button"
          disabled={busy}
          className="flex h-[21px] flex-none items-center gap-1 rounded border border-[rgba(167,139,250,.4)] px-2 text-[0.625rem] text-[#a78bfa] hover:bg-[#a78bfa]/10 disabled:opacity-40"
          onClick={() => setConfirm({ batchId: b.id, paths: revertable.map((f) => f.path) })}
        >
          <ArrowCounterClockwise size="0.625rem" aria-hidden /> {t("回退整批({n})", { n: revertable.length })}
        </button>
      )}
      {st === "reverted" && (
        <button
          type="button"
          disabled={busy}
          className="flex h-[21px] flex-none items-center gap-1 rounded border border-(--tmd-diff-inserted)/40 px-2 text-[0.625rem] text-(--tmd-diff-inserted) hover:bg-(--tmd-diff-inserted)/10 disabled:opacity-40"
          title={t("按账本副本把这轮改动精确写回(live 已偏离批前像的文件跳过,绝不覆盖)")}
          onClick={() => setConfirm({ batchId: b.id, mode: "apply" })}
        >
          <Lightning size="0.625rem" aria-hidden /> {t("应用回此批")}
        </button>
      )}
      {st === "reverted" && b.guardId && (
        <button
          type="button"
          disabled={busy}
          className="flex h-[21px] flex-none items-center gap-1 rounded border border-(--tmd-border) px-2 text-[0.625rem] text-(--tmd-fg-subtle) hover:bg-(--tmd-bg-hover) disabled:opacity-40"
          onClick={() => void onUndo(b.id)}
        >
          <ArrowUUpLeft size="0.625rem" aria-hidden /> {t("反悔 · 恢复回来")}
        </button>
      )}
      <span className="truncate text-[0.625rem] text-(--tmd-fg-faint)">
        {statusHint(st)}
      </span>
    </div>
  );
}

export function BatchRow({
  batch: b,
  last,
  busy,
  confirm,
  setConfirm,
  onApprove,
  onRevert,
  onApply,
  onUndo,
  cwd,
  sessionId,
  tmdSessionId,
}: {
  batch: CkptBatch;
  last: boolean;
  busy: boolean;
  confirm: ConfirmTarget | null;
  setConfirm: (v: ConfirmTarget | null) => void;
  onApprove: (batchId: string) => Promise<void>;
  onRevert: (batchId: string, paths?: string[]) => Promise<void>;
  onApply: (batchId: string) => Promise<void>;
  onUndo: (batchId: string) => Promise<void>;
  cwd: string;
  sessionId: string;
  tmdSessionId?: string;
}) {
  // 批 diff 懒加载(含 open 批,时间线 ± 与审阅单共用同一缓存);
  // open 批新像 = live 工作区,轮内改动定时跟进,封口后停
  useEffect(() => {
    loadDiff(cwd, b.id);
    if (!b.open) return;
    const timer = window.setInterval(() => refreshOpenDiff(cwd, b.id), POLL_MS);
    return () => window.clearInterval(timer);
  }, [cwd, b.id, b.open]);

  return (
    <div className="relative mb-1.5">
      {!last && <span className="absolute bottom-1 left-[7px] top-6 w-px bg-(--tmd-border)" aria-hidden />}

      {/* 批头 → 审阅单 */}
      <BatchHeadButton b={b} cwd={cwd} sessionId={sessionId} tmdSessionId={tmdSessionId} />

      {/* 文件行 → 审阅单深链 */}
      <div className="ml-4 mt-px">
        {b.files.map((f) => (
          <FileRow
            key={f.path}
            file={f}
            batch={b}
            cwd={cwd}
            sessionId={sessionId}
            tmdSessionId={tmdSessionId}
            busy={busy}
            setConfirm={setConfirm}
          />
        ))}
      </div>

      {/* 批尾动作 */}
      <BatchActionBar b={b} st={batchState(b)} busy={busy} setConfirm={setConfirm} onApprove={onApprove} onUndo={onUndo} />

      {/* 动作确认(内联卡;回退/应用共用,镜像文案) */}
      {confirm && <ConfirmCard batchId={b.id} confirm={confirm} busy={busy} setConfirm={setConfirm} onRevert={onRevert} onApply={onApply} />}
    </div>
  );
}
