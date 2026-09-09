/**
 * BatchRow 拆件 —— 自 BatchRow.tsx 拆出(文件规模铁则)。
 *
 * 内联确认卡(回退/应用共用,mode 区分文案与动作)+ 文件行
 * (状态 chip + 路径 + ± + 深链审阅单 + hover 单文件回退)。
 * ConfirmTarget 类型唯一定义于此,BatchRow re-export 维持既有导入契约。
 */

import { ArrowCounterClockwise } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import type { CkptBatch, CkptBatchFile } from "@kernel/ipc";
import { getCachedDiff } from "./store";
import { openBatchTab } from "./batchTab";

/** 内联确认卡目标:mode 区分回退(默认,兼容既有 paths 子集语义)与应用。 */
export interface ConfirmTarget {
  batchId: string;
  paths?: string[];
  mode?: "revert" | "apply";
}

export function fileChipCls(st: string): string {
  if (st === "A") return "bg-(--tmd-diff-inserted)/15 text-(--tmd-diff-inserted)";
  if (st === "D") return "bg-(--tmd-diff-removed)/15 text-(--tmd-diff-removed)";
  return "bg-(--tmd-git-modified)/15 text-(--tmd-git-modified)";
}

export function ConfirmCard({
  batchId,
  confirm,
  busy,
  setConfirm,
  onRevert,
  onApply,
}: {
  batchId: string;
  confirm: ConfirmTarget;
  busy: boolean;
  setConfirm: (v: ConfirmTarget | null) => void;
  onRevert: (batchId: string, paths?: string[]) => Promise<void>;
  onApply: (batchId: string) => Promise<void>;
}) {
  const apply = confirm.mode === "apply";
  return (
    <div className="ml-4 mb-2 rounded-(--tmd-radius-sm) border border-(--tmd-border-strong) bg-(--tmd-bg-popover) p-2.5">
      <div className="mb-1 text-xs font-semibold">
        {apply
          ? t("应用回此批")
          : t("回退{target}", {
              target: confirm.paths ? t("{n} 个路径", { n: confirm.paths.length }) : t("整批"),
            })}
      </div>
      <div className="mb-2 text-[0.6875rem] leading-relaxed text-(--tmd-fg-muted)">
        {apply ? (
          <>
            {t("按账本副本把这轮改动精确写回磁盘(回退的镜像);")}
            <span className="text-(--tmd-diff-inserted)">{t("执行前已自动打恢复点,可反悔")}</span>。
            {t("live 已偏离批前像的文件按 diff 精准重放,改动重叠才跳过。")}
          </>
        ) : (
          <>
            {t("改动将还原到这轮消息发出之前;")}
            <span className="text-(--tmd-diff-inserted)">{t("回退前已自动打恢复点,可反悔")}</span>。
            {t("共改文件按 diff 精准擦除(只擦本批改动),重叠才跳过。")}
          </>
        )}
      </div>
      <div className="flex justify-end gap-1.5">
        <button
          type="button"
          className="h-6 rounded border border-(--tmd-border) px-2 text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover)"
          onClick={() => setConfirm(null)}
        >
          {t("取消")}
        </button>
        <button
          type="button"
          disabled={busy}
          className={
            apply
              ? "h-6 rounded border border-(--tmd-diff-inserted)/50 px-2 text-(--tmd-diff-inserted) hover:bg-(--tmd-diff-inserted)/10 disabled:opacity-40"
              : "h-6 rounded border border-[rgba(167,139,250,.5)] px-2 text-[#a78bfa] hover:bg-[#a78bfa]/10 disabled:opacity-40"
          }
          onClick={() =>
            apply ? void onApply(batchId) : void onRevert(batchId, confirm.paths)
          }
        >
          {apply ? t("确认应用") : t("确认回退")}
        </button>
      </div>
    </div>
  );
}

export function FileRow({
  file: f,
  batch: b,
  cwd,
  sessionId,
  tmdSessionId,
  busy,
  setConfirm,
}: {
  file: CkptBatchFile;
  batch: CkptBatch;
  cwd: string;
  sessionId: string;
  tmdSessionId?: string;
  busy: boolean;
  setConfirm: (v: ConfirmTarget | null) => void;
}) {
  const canRevert = b.state === "pending" && f.live === "same" && !f.noBaseline;
  const segs = f.path.split("/");
  const name = segs.pop() ?? f.path;
  const dir = segs.length ? segs.join("/") + "/" : "";
  const patches = getCachedDiff(cwd, b.id);
  const mine = patches?.find((p) => p.path === f.path);
  return (
    <div className="group flex h-[25px] items-center gap-1.5 rounded px-1.5 hover:bg-(--tmd-bg-hover)">
      <button
        type="button"
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left"
        title={t("点击在编辑区查看该文件 diff")}
        onClick={() =>
          openBatchTab({
            cwd,
            sessionId,
            tmdSessionId,
            batchId: b.id,
            title: t("批次 #{index}", { index: b.index }),
            focusPath: f.path,
          })
        }
      >
        <span
          className={`grid h-[14px] w-[14px] flex-none place-items-center rounded text-[0.625rem] font-bold ${fileChipCls(f.status)}`}
        >
          {f.status}
        </span>
        {f.editCount > 0 && b.attribution === "events" && (
          <span
            className="flex-none rounded border border-(--tmd-border) px-1 text-[0.5625rem] leading-[0.8125rem] text-(--tmd-fg-faint)"
            title={t("AI 本轮写入该文件 {n} 次(事件流轨迹,账本可审计)", { n: f.editCount })}
          >
            ×{f.editCount}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-[0.6875rem] text-(--tmd-fg-muted)">
          <b className="font-medium text-(--tmd-fg)">{name}</b>{" "}
          <span className="text-(--tmd-fg-faint)">{dir}</span>
        </span>
        {mine && (
          <span className="flex-none font-mono text-[0.625rem]">
            <span className="text-(--tmd-diff-inserted)">+{mine.additions}</span>{" "}
            <span className="text-(--tmd-diff-removed)">−{mine.deletions}</span>
          </span>
        )}
        {f.reverted && (
          <span className="flex-none rounded border border-dashed border-[#a78bfa] px-1 text-[0.625rem] leading-[0.875rem] text-[#a78bfa]">
            {t("已退")}
          </span>
        )}
        {f.stale && (
          <span
            className="flex-none rounded border border-dashed border-(--tmd-fg-faint) px-1 text-[0.625rem] leading-[0.875rem] text-(--tmd-fg-faint)"
            title={t("工作区内容已偏离本批后像,不可回退,仅可对照")}
          >
            {t("内容已变")}
          </span>
        )}
        {f.noBaseline && (
          <span
            className="flex-none rounded border border-dashed border-(--tmd-fg-faint) px-1 text-[0.625rem] leading-[0.875rem] text-(--tmd-fg-faint)"
            title={t("工作区外文件,首轮批前像不可知 —— 禁回退(防误删既有文件);次轮起可正常回退")}
          >
            {t("无前像")}
          </span>
        )}
      </button>
      {canRevert && (
        <button
          type="button"
          disabled={busy}
          className="hidden h-[19px] w-[19px] flex-none place-items-center rounded text-(--tmd-fg-subtle) group-hover:grid hover:bg-[#a78bfa]/15 hover:text-[#a78bfa] disabled:opacity-40"
          title={t("只回退这个文件")}
          onClick={() => setConfirm({ batchId: b.id, paths: [f.path] })}
        >
          <ArrowCounterClockwise size="0.6875rem" aria-hidden />
        </button>
      )}
    </div>
  );
}
