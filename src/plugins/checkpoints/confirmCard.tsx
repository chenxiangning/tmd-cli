/**
 * 内联确认卡(回退/应用/反悔共用,mode 区分)—— 042 项6 升级:回退挂载时
 * 发起 checkpoint_restore_preview dry-run,纯文案卡升级为预览表
 * (fileChipCls 同源配色 + 「覆盖本地」药丸只打精准擦除成功行 + 默认 6 行
 * 截断展开)。plan 空(E_EMPTY)免弹直接走回退,中性提示由 doRevert 出;
 * undo 复用 revert 时缓存的预览,不新发 dry-run;弹层内冻结不刷新
 * (执行时后端用最新 live 重新判定,skip 兜底安全);IPC 失败回落纯文案
 * + 错误短句,不阻塞确认。
 */

import { useEffect, useRef, useState } from "react";
import { t } from "@kernel/i18n";
import { formatAbsolute } from "@kernel/relativeTime";
import type { CkptBatch, CkptRestorePreview } from "@kernel/ipc";
import { getCachedPreviewForBatch, loadPreview } from "./diffCache";
import { skippedNote } from "./useCheckpointActions";
import { fileChipCls } from "./fileChipCls";

/** 内联确认卡目标:mode 区分回退(默认,兼容既有 paths 子集语义)/应用/反悔。 */
export interface ConfirmTarget {
  batchId: string;
  paths?: string[];
  mode?: "revert" | "apply" | "undo";
}

/** 预览表默认行上限(常量,非用户可调;超出折叠进「共 N 文件」展开)。 */
const PREVIEW_ROW_LIMIT = 6;
/** plan 空信号(E_EMPTY_PLAN 结构化前缀,免弹直接走回退)。 */
const EMPTY_PLAN_MARK = "E_EMPTY_PLAN";

/** 冻结预览:仅挂载时拉一次(undo 走缓存复用,弹层内不刷新);plan 空免弹直走回退。 */
function useFrozenPreview(
  mode: "revert" | "apply" | "undo",
  cwd: string,
  sessionId: string,
  confirm: ConfirmTarget,
  setConfirm: (v: ConfirmTarget | null) => void,
  onRevert: (batchId: string, paths?: string[]) => Promise<void>,
) {
  const [preview, setPreview] = useState<CkptRestorePreview | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    if (mode === "apply") return;
    if (mode === "undo") {
      setPreview(getCachedPreviewForBatch(cwd, sessionId, confirm.batchId) ?? null);
      return;
    }
    /* revert 每次挂载现发 dry-run:跨弹层的缓存可能因回退/应用/外部改动陈旧
       (「覆盖本地」药丸缺失 = 预览骗人);undo 才吃缓存(上方分支)。 */
    loadPreview(cwd, sessionId, confirm.batchId, confirm.paths, { fresh: true })
      .then(setPreview)
      .catch((e: unknown) => {
        const raw = String(e);
        if (raw.startsWith(EMPTY_PLAN_MARK)) {
          // plan 空(E_EMPTY_PLAN):免弹直接走回退(空操作),中性提示由 doRevert 出。
          setConfirm(null);
          void onRevert(confirm.batchId, confirm.paths);
          return;
        }
        setPreviewErr(raw.replace(/^E_\w+:\s*/, "").slice(0, 200));
      });
  }, [mode, cwd, sessionId, confirm, setConfirm, onRevert]);
  return { preview, previewErr };
}

/** 预览表:快照头 + A/M/D 药丸行 + 覆盖本地药丸(仅 surgical 擦除行)+ 6 行截断展开 + skip 注。 */
function PreviewTable({ batch, preview }: { batch: CkptBatch; preview: CkptRestorePreview }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? preview.rows : preview.rows.slice(0, PREVIEW_ROW_LIMIT);
  return (
    <>
      <div className="mb-1 text-2xs text-(--tmd-fg-faint)">
        {t("快照 · 轮 {turn} · {time} · 共 {n} 文件", {
          turn: batch.index,
          time: formatAbsolute(batch.ts),
          n: preview.rows.length,
        })}
        {batch.engine ? ` · ${batch.engine}` : ""}
      </div>
      <div className="mb-1.5 max-h-40 overflow-y-auto">
        {visible.map((r) => (
          <div key={r.path} className="flex h-[19px] items-center gap-1.5 font-mono text-meta">
            <span
              className={`grid h-[14px] w-[14px] flex-none place-items-center rounded font-bold ${fileChipCls(r.kind)}`}
            >
              {r.kind}
            </span>
            <span className="min-w-0 flex-1 truncate text-(--tmd-fg-muted)" title={r.path}>
              {r.path}
            </span>
            {r.overwrites && (
              <span className="flex-none rounded bg-(--tmd-diff-removed)/15 px-1 font-sans font-bold text-(--tmd-diff-removed)">
                {t("覆盖本地")}
              </span>
            )}
            <span className="flex-none">
              <span className="text-(--tmd-diff-inserted)">+{r.additions}</span>{" "}
              <span className="text-(--tmd-diff-removed)">−{r.deletions}</span>
            </span>
          </div>
        ))}
        {preview.rows.length > PREVIEW_ROW_LIMIT && !expanded && (
          <button
            type="button"
            className="mt-0.5 text-meta text-(--tmd-fg-faint) hover:text-(--tmd-fg-muted)"
            onClick={() => setExpanded(true)}
          >
            {t("共 {n} 文件 · 展开其余 {m}", {
              n: preview.rows.length,
              m: preview.rows.length - PREVIEW_ROW_LIMIT,
            })}
          </button>
        )}
        {preview.skipped.length > 0 && (
          <div
            className="mt-1 truncate text-meta text-(--tmd-fg-faint)"
            title={skippedNote(preview.skipped)}
          >
            {t("跳过:{skipped}", { skipped: skippedNote(preview.skipped) })}
          </div>
        )}
      </div>
    </>
  );
}

/** 纯文案段:应用模式、undo 无缓存预览、或预览失败的回落形态(信息增强永不阻塞确认)。 */
function FallbackText({ mode }: { mode: "revert" | "apply" | "undo" }) {
  return (
    <div className="mb-2 text-xs leading-relaxed text-(--tmd-fg-muted)">
      {mode === "apply" ? (
        <>
          {t("按账本副本把这轮改动精确写回磁盘(回退的镜像);")}
          <span className="text-(--tmd-diff-inserted)">{t("执行前已自动打恢复点,可反悔")}</span>。
          {t("live 已偏离批前像的文件按 diff 精准重放,改动重叠才跳过。")}
        </>
      ) : mode === "undo" ? (
        <>
          {t("按恢复点守卫把这批写回回退前的状态;")}
          <span className="text-(--tmd-diff-inserted)">{t("内容失配的路径会跳过,绝不覆盖")}</span>。
        </>
      ) : (
        <>
          {t("改动将还原到这轮消息发出之前;")}
          <span className="text-(--tmd-diff-inserted)">{t("回退前已自动打恢复点,可反悔")}</span>。
          {t("共改文件按 diff 精准擦除(只擦本批改动),重叠才跳过。")}
        </>
      )}
    </div>
  );
}

/** 卡片标题(revert 带路径数/整批后缀)。 */
function titleFor(mode: "revert" | "apply" | "undo", confirm: ConfirmTarget): string {
  if (mode === "apply") return t("应用回此批");
  if (mode === "undo") return t("反悔 · 恢复到回退前");
  return t("回退{target}", {
    target: confirm.paths ? t("{n} 个路径", { n: confirm.paths.length }) : t("整批"),
  });
}

/** 主按钮确认文案(ConfirmCard 复杂度拆分缝:no-high-complexity 预算内出组件)。 */
function confirmLabel(mode: "revert" | "apply" | "undo"): string {
  return mode === "apply" ? t("确认应用") : mode === "undo" ? t("确认反悔") : t("确认回退");
}

/** 主按钮动作(revert 可带子集路径)。 */
function runAction(mode: "revert" | "apply" | "undo", confirm: ConfirmTarget, actions: {
  onRevert: (batchId: string, paths?: string[]) => Promise<void>;
  onApply: (batchId: string) => Promise<void>;
  onUndo: (batchId: string) => Promise<void>;
}): () => Promise<void> {
  if (mode === "apply") return () => actions.onApply(confirm.batchId);
  if (mode === "undo") return () => actions.onUndo(confirm.batchId);
  return () => actions.onRevert(confirm.batchId, confirm.paths);
}

export function ConfirmCard({
  batch,
  confirm,
  busy,
  cwd,
  sessionId,
  setConfirm,
  onRevert,
  onApply,
  onUndo,
}: {
  batch: CkptBatch;
  confirm: ConfirmTarget;
  busy: boolean;
  cwd: string;
  sessionId: string;
  setConfirm: (v: ConfirmTarget | null) => void;
  onRevert: (batchId: string, paths?: string[]) => Promise<void>;
  onApply: (batchId: string) => Promise<void>;
  onUndo: (batchId: string) => Promise<void>;
}) {
  const mode = confirm.mode ?? "revert";
  const { preview, previewErr } = useFrozenPreview(mode, cwd, sessionId, confirm, setConfirm, onRevert);
  const overwriteCount = preview?.rows.filter((r) => r.overwrites).length ?? 0;
  const showPreview = mode !== "apply" && preview !== null && previewErr === null;
  const run = runAction(mode, confirm, { onRevert, onApply, onUndo });
  return (
    <div className="ml-4 mb-2 rounded-(--tmd-radius-sm) border border-(--tmd-border-strong) bg-(--tmd-bg-popover) p-2.5">
      <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold">
        {titleFor(mode, confirm)}
        {showPreview && overwriteCount > 0 && (
          <span className="rounded bg-(--tmd-diff-removed)/15 px-1 text-meta font-bold text-(--tmd-diff-removed)">
            {t("覆盖本地 {n}", { n: overwriteCount })}
          </span>
        )}
      </div>
      {showPreview && <PreviewTable batch={batch} preview={preview} />}
      {previewErr && (
        <div className="mb-2 text-meta text-(--tmd-diff-removed)">
          {t("预览不可用,已回落文案确认:{err}", { err: previewErr })}
        </div>
      )}
      {!showPreview && <FallbackText mode={mode} />}
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
            mode === "revert"
              ? "h-6 rounded border border-[rgba(167,139,250,.5)] px-2 text-[#a78bfa] hover:bg-[#a78bfa]/10 disabled:opacity-40"
              : "h-6 rounded border border-(--tmd-diff-inserted)/50 px-2 text-(--tmd-diff-inserted) hover:bg-(--tmd-diff-inserted)/10 disabled:opacity-40"
          }
          onClick={() => void run()}
        >
          {confirmLabel(mode)}
        </button>
      </div>
    </div>
  );
}
