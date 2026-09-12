/**
 * BatchSheet 拆件 —— 工具条/回退确认条/用户消息卡(no-high-complexity 降分支 +
 * 文件规模铁则):BatchSheet.tsx 只留数据编排与动作。
 */

import { ArrowCounterClockwise, Check } from "@phosphor-icons/react";
import { formatAbsolute, formatRelativeTime } from "@kernel/relativeTime";
import { t } from "@kernel/i18n";
import type { CkptBatch, CkptPatch } from "@kernel/ipc";
import { PromptImages } from "./PromptImages";
import type { PromptImagesExtract } from "./promptImagesExtract";

/** 轮耗时短语(锚点 → 封口);秒取整,分段到时。 */
function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return t("{s} 秒", { s });
  const m = Math.floor(s / 60);
  if (m < 60) return t("{m} 分 {s} 秒", { m, s: s % 60 });
  return t("{h} 小时 {m} 分", { h: Math.floor(m / 60), m: m % 60 });
}

/** 批次状态短语:进行中/待审/已通过/已退/已处理+原因(no-high-complexity 降分支)。 */
function sheetStateLabel(batch: CkptBatch): string {
  if (batch.open) return t("进行中");
  if (batch.state === "done") return t("已处理 · {reason}", { reason: t(batch.doneReason ?? "") });
  if (batch.state === "approved") return t("已通过");
  if (batch.state === "reverted") return t("已退");
  return t("待审");
}

/** 工具条动作:通过(待审)+ 回退整批(待审/已通过且有可退文件)(降分支拆件)。 */
function SheetActions({
  batch,
  busy,
  revertableCount,
  onApprove,
  onRevertAll,
}: {
  batch: CkptBatch;
  busy: boolean;
  revertableCount: number;
  onApprove: () => void;
  onRevertAll: () => void;
}) {
  return (
    <>
      {batch.state === "pending" && (
        <button
          type="button"
          disabled={busy}
          className="flex h-6 items-center gap-1 rounded border border-(--tmd-diff-inserted)/40 px-2 text-[0.6875rem] text-(--tmd-diff-inserted) hover:bg-(--tmd-diff-inserted)/10 disabled:opacity-40"
          title={t("标记本批已审阅(纯标记,不影响任何文件)")}
          onClick={onApprove}
        >
          <Check size="0.625rem" aria-hidden /> {t("通过")}
        </button>
      )}
      {(batch.state === "pending" || batch.state === "approved") && revertableCount > 0 && (
        <button
          type="button"
          disabled={busy}
          className="flex h-6 items-center gap-1 rounded border border-[rgba(167,139,250,.4)] px-2 text-[0.6875rem] text-[#a78bfa] hover:bg-[#a78bfa]/10 disabled:opacity-40"
          onClick={onRevertAll}
        >
          <ArrowCounterClockwise size="0.625rem" aria-hidden /> {t("回退整批({n})", { n: revertableCount })}
        </button>
      )}
    </>
  );
}

/** 审阅单工具条:批次标题 + ±stats + 通过/回退整批(降分支拆件)。 */
export function SheetToolbar({
  batch,
  patches,
  busy,
  revertableCount,
  onApprove,
  onRevertAll,
}: {
  batch: CkptBatch;
  patches: CkptPatch[] | null;
  busy: boolean;
  revertableCount: number;
  onApprove: () => void;
  onRevertAll: () => void;
}) {
  const stateLabel = sheetStateLabel(batch);
  return (
    <div className="flex h-8 flex-none items-center gap-2 border-b border-(--tmd-border) bg-(--tmd-bg-elevated) px-3">
      <span
        className="text-[0.6875rem] text-(--tmd-fg-faint)"
        title={batch.tsEnd
          ? t("{start} 发起 · {end} 封口", { start: formatAbsolute(batch.ts), end: formatAbsolute(batch.tsEnd) })
          : t("{start} 发起", { start: formatAbsolute(batch.ts) })}
      >
        {t("批次 #{index} · {state} · {time}", { index: batch.index, state: stateLabel, time: formatRelativeTime(batch.ts) })}
      </span>
      {patches && (
        <span className="font-mono text-[0.6875rem]">
          <span className="text-(--tmd-diff-inserted)">
            +{patches.reduce((s, p) => s + p.additions, 0)}
          </span>{" "}
          <span className="text-(--tmd-diff-removed)">
            −{patches.reduce((s, p) => s + p.deletions, 0)}
          </span>
        </span>
      )}
      <span className="flex-1" />
      <SheetActions batch={batch} busy={busy} revertableCount={revertableCount} onApprove={onApprove} onRevertAll={onRevertAll} />
    </div>
  );
}

/** 内联回退确认条:整批/单文件两态共用(降分支拆件)。 */
export function SheetConfirmBar({
  target,
  revertableCount,
  busy,
  onCancel,
  onConfirm,
}: {
  target: "all" | string;
  revertableCount: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="flex flex-none items-center gap-3 border-b border-(--tmd-border-strong) bg-(--tmd-bg-popover) px-3 py-1.5 text-[0.6875rem]">
      <span className="text-(--tmd-fg-muted)">
        {t("确认回退{target}? 恢复点自动留存。", {
          target: target === "all" ? t("整批({n} 文件)", { n: revertableCount }) : target,
        })}
      </span>
      <button
        type="button"
        className="rounded border border-(--tmd-border) px-2 py-0.5 text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover)"
        onClick={onCancel}
      >
        {t("取消")}
      </button>
      <button
        type="button"
        disabled={busy}
        className="rounded border border-[rgba(167,139,250,.5)] px-2 py-0.5 text-[#a78bfa] hover:bg-[#a78bfa]/10 disabled:opacity-40"
        onClick={onConfirm}
      >
        {t("确认回退")}
      </button>
    </div>
  );
}

/** 用户消息卡:账本随批固化的引擎/模型/思考/时刻元信息 + 附件缩略图 + 净文本(降分支拆件)。 */
export function SheetPromptCard({
  batch,
  prompt,
}: {
  batch: CkptBatch;
  prompt: PromptImagesExtract;
}) {
  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.6875rem] text-(--tmd-fg-faint)">
        <span className="flex-none">{t("用户消息")}</span>
        {batch.engine && (
          <span className="flex-none rounded border border-(--tmd-border) bg-(--tmd-bg-elevated) px-1 text-[0.625rem] leading-[1rem] text-(--tmd-fg-muted)">
            {batch.engine}
          </span>
        )}
        {batch.model && (
          <span className="flex-none font-mono text-(--tmd-fg-muted)">{batch.model}</span>
        )}
        {batch.thinking && (
          <span className="flex-none">
            {t("思考")} <span className="font-mono text-(--tmd-fg-muted)">{batch.thinking}</span>
          </span>
        )}
        <span className="flex-none">
          {formatAbsolute(batch.ts)}
          <span className="ml-1.5">({formatRelativeTime(batch.ts)})</span>
        </span>
        {batch.tsEnd != null && batch.tsEnd > batch.ts && (
          <span className="flex-none">{t("耗时 {duration}", { duration: formatDuration(batch.tsEnd - batch.ts) })}</span>
        )}
      </div>
      {/* 图片附件缩略图横排(点击放大);净文本为空(纯附件消息)不出文本块 */}
      <PromptImages images={prompt.images} />
      {prompt.text ? (
        <div className="whitespace-pre-wrap break-words rounded-r border-l-2 border-(--tmd-accent) bg-(--tmd-bg-hover) px-3.5 py-2.5 text-[0.8125rem] leading-relaxed text-(--tmd-fg)">
          {prompt.text}
        </div>
      ) : null}
    </>
  );
}
