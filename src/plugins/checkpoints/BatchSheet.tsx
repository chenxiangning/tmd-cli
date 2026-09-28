/**
 * BatchSheet —— 中央「批审阅单」tab(spec §4,editorCenter.tabContent 挂载)。
 *
 * 一批一个 tab:用户消息全文卡 + "AI 修改的文件"分区列表(各自 unified diff,
 * 默认展开可折叠);文件行深链滚动到分区并高亮。
 * 会话严格绑定:清单按 payload 里的 (cwd, sessionId) 取 —— 会话切换/结束后,
 * 旧审阅单显示"已随会话结束"。
 * 动作同面板:回退唯一(整批/单文件,带确认),done 无操作。
 * 非 ckpt-batch kind 的 tab 返回 null —— 每种 kind 的渲染由各自插件负责。
 * 文件分区与居中占位拆至 BatchFileSection.tsx,工具条/确认条/消息卡拆至
 * batchSheetParts.tsx(no-high-complexity 降分支 + 文件规模铁则)。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { CircleNotch } from "@phosphor-icons/react";
import type { EditorTab } from "@kernel/tabs";
import { t } from "@kernel/i18n";
import type { CkptBatch } from "@kernel/ipc";
import { approveBatch, refreshBatches, revertBatch, useCkptVersion, useCkptBatches } from "./store";
import { getCachedDiff, getCachedDiffError, loadDiff, refreshOpenDiff } from "./diffCache";
import { readBatchPayload } from "./batchTab";
import { extractPromptImages } from "./promptImagesExtract";
import { Center, FileSections } from "./BatchFileSection";
import { SheetConfirmBar, SheetPromptCard, SheetToolbar } from "./batchSheetParts";

export function BatchSheetTabContent({ tab }: { tab: EditorTab }) {
  const payload = readBatchPayload(tab);
  if (!payload) return null;
  return (
    <BatchSheet
      key={`${payload.sessionId}:${payload.batchId}`}
      cwd={payload.cwd}
      sessionId={payload.sessionId}
      tmdSessionId={payload.tmdSessionId}
      batchId={payload.batchId}
      focusPath={payload.focusPath}
    />
  );
}

function BatchSheet({
  cwd,
  sessionId,
  tmdSessionId,
  batchId,
  focusPath,
}: {
  cwd: string;
  sessionId: string;
  tmdSessionId?: string;
  batchId: string;
  focusPath?: string;
}) {
  useCkptVersion();
  const { batches, notARepo } = useCkptBatches(cwd, sessionId);
  const batch = batches.find((b) => b.id === batchId);
  useEffect(() => {
    // 审阅单挂载即拉该批 patch(与时间线共享缓存)
    loadDiff(cwd, sessionId, batchId);
    // open 批新像 = live 工作区:轮内改动要跟进,定时强刷直到封口
    if (!batch?.open) return;
    const timer = window.setInterval(() => refreshOpenDiff(cwd, sessionId, batchId), 6000);
    return () => window.clearInterval(timer);
  }, [cwd, sessionId, batchId, batch?.open]);

  if (notARepo) {
    return <Center>{t("该工作区不是 git 仓库,无审批数据")}</Center>;
  }
  if (!batch) {
    return <Center>{t("批次不存在或已随会话结束(审批线生命周期 = 单个会话)")}</Center>;
  }
  return (
    <SheetBody
      cwd={cwd}
      sessionId={sessionId}
      tmdSessionId={tmdSessionId}
      batch={batch}
      focusPath={focusPath}
    />
  );
}

function SheetBody({
  cwd,
  sessionId,
  tmdSessionId,
  batch,
  focusPath,
}: {
  cwd: string;
  sessionId: string;
  tmdSessionId?: string;
  batch: CkptBatch;
  focusPath?: string;
}) {
  useCkptVersion();
  const patches = getCachedDiff(cwd, sessionId, batch.id) ?? null;
  const diffError = getCachedDiffError(cwd, sessionId, batch.id);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [confirmPath, setConfirmPath] = useState<"all" | string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  /** 图片附件 token 剥离(缩略图横排 + 净文本);prompt 随批固化,memo 一次即可。 */
  const promptContent = useMemo(() => extractPromptImages(batch.prompt), [batch.prompt]);
  const [flash, setFlash] = useState<string | null>(focusPath ?? null);

  // 深链定位:滚动到目标分区并高亮
  useEffect(() => {
    if (!focusPath || !patches) return;
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-file="${CSS.escape(focusPath)}"]`);
    if (el) {
      el.scrollIntoView({ block: "center" });
      setFlash(focusPath);
      const timer = window.setTimeout(() => setFlash(null), 1400);
      return () => window.clearInterval(timer);
    }
  }, [focusPath, patches]);

  /* 错误短句:E_XXX 前缀剥掉(与 useCheckpointActions 同口径)。 */
  const actionErrMsg = (e: unknown): string => String(e).replace(/^E_\w+:\s*/, "");

  async function doApprove() {
    setBusy(true);
    setActionError(null);
    try {
      await approveBatch(cwd, batch.id);
    } catch (e) {
      /* 审阅单全屏使用时时间线 notice 不可见,失败必须就地可见(评审 CKPT-2) */
      setActionError(actionErrMsg(e));
    } finally {
      setBusy(false);
      void refreshBatches(cwd, sessionId, tmdSessionId);
    }
  }

  async function doRevert(paths?: string[]) {
    setBusy(true);
    setConfirmPath(null);
    setActionError(null);
    try {
      await revertBatch(cwd, sessionId, batch.id, paths);
    } catch (e) {
      /* 曾静默(注释称时间线会展示同源错误)—— 中央审阅单场景无时间线,就地展示 */
      setActionError(actionErrMsg(e));
    } finally {
      setBusy(false);
      void refreshBatches(cwd, sessionId, tmdSessionId);
    }
  }

  const revertable = batch.files.filter((f) => f.live === "same" && !f.noBaseline);

  return (
    <div className="flex h-full flex-col">
      {/* 工具条 */}
      <SheetToolbar
        batch={batch}
        patches={patches}
        busy={busy}
        revertableCount={revertable.length}
        onApprove={() => void doApprove()}
        onRevertAll={() => setConfirmPath("all")}
      />

      {actionError && (
        <div
          role="alert"
          className="mx-4 mb-2 rounded border border-(--tmd-diff-removed) bg-(--tmd-diff-removed)/10 p-2 text-[0.6875rem] text-(--tmd-diff-removed)"
        >
          {actionError}
        </div>
      )}

      {confirmPath && (
        <SheetConfirmBar
          target={confirmPath}
          revertableCount={revertable.length}
          busy={busy}
          onCancel={() => setConfirmPath(null)}
          onConfirm={() => void doRevert(confirmPath === "all" ? undefined : [confirmPath])}
        />
      )}

      {/* 审阅单 */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {!patches && diffError ? (
          <div className="flex flex-col items-center gap-2 pt-10">
            <div role="alert" className="text-xs text-(--tmd-danger, #e5484d)">
              {t("批 diff 拉取失败:{msg}", { msg: diffError })}
            </div>
            <button
              type="button"
              onClick={() => refreshOpenDiff(cwd, sessionId, batch.id)}
              className="rounded border border-(--tmd-border) px-2 py-1 text-xs text-(--tmd-fg-muted) hover:border-(--tmd-accent) hover:text-(--tmd-accent)"
            >
              {t("重试")}
            </button>
          </div>
        ) : !patches ? (
          <div className="flex items-center justify-center gap-2 pt-10 text-(--tmd-fg-faint)">
            <CircleNotch size="0.8125rem" className="animate-spin" aria-hidden /> {t("生成批 diff…")}
          </div>
        ) : (
          <>
            <SheetPromptCard batch={batch} prompt={promptContent} />
            <FileSections
              batch={batch}
              patches={patches}
              flash={flash}
              busy={busy}
              onRevertPath={(p) => setConfirmPath(p)}
            />
          </>
        )}
      </div>
    </div>
  );
}
