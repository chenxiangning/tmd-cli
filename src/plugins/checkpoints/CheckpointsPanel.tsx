/**
 * CheckpointsPanel —— 右栏「审批线」时间线(spec §4,D 主形态)。
 * 摘要行/批清单/横幅拆本文件内 PanelSummaryBar/BatchListView/PanelNoticeBanner/
 * PanelErrorBanner,身份解析与刷新调度拆至 useCkptScope.ts
 * (no-high-complexity 降分支 + 文件规模铁则)。
 */

import { useState } from "react";
import { ClockClockwise, ClockCounterClockwise, CircleNotch } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { BatchRow, type ConfirmTarget } from "./BatchRow";
import { TimelineCount, TimelinePanel } from "./TimelinePanel";
import { refreshBatches, useCkptBatches } from "./store";
import { useCheckpointActions } from "./useCheckpointActions";
import { useCkptAutoRefresh, useCkptScope } from "./useCkptScope";
import type { CkptBatch } from "@kernel/ipc";

/** useCkptBatches 返回面(结构化定义;store 未导出该契约,不为其开口)。 */
interface CwdCkptState {
  batches: CkptBatch[];
  loading: boolean;
  error: string | null;
  notARepo: boolean;
}

/** 摘要行 —— 字号对齐面板体系(11px 为主),项目名用扁平标签非胶囊(降分支拆件)。 */
function PanelSummaryBar({
  view,
  onView,
  shown,
  pendingCount,
}: {
  view: "batch" | "timeline";
  onView: (v: "batch" | "timeline") => void;
  shown: { name: string; root: string } | null;
  pendingCount: number;
}) {
  return (
    <div className="flex h-[30px] flex-none items-center gap-2 border-b border-(--tmd-border) bg-(--tmd-bg-elevated) px-2.5 text-[0.6875rem]">
      <div className="flex flex-none items-center gap-0.5">
        <button type="button" onClick={() => onView("batch")} className={segCls(view === "batch")}>
          <ClockClockwise size="0.6875rem" aria-hidden />
          {t("审批线")}
        </button>
        <button type="button" onClick={() => onView("timeline")} className={segCls(view === "timeline")}>
          <ClockCounterClockwise size="0.6875rem" aria-hidden />
          {t("时间线")}
        </button>
      </div>
      {shown && (
        <span className="max-w-[45%] truncate text-[0.625rem] text-(--tmd-fg-faint)" title={shown.root}>
          {shown.name}
        </span>
      )}
      <span className="flex-1" />
      {view === "batch" ? (
        <span className="flex-none text-(--tmd-fg-faint)">
          {t("待审")} <b className="font-semibold text-(--tmd-git-modified)">{pendingCount}</b>
        </span>
      ) : (
        <TimelineCount />
      )}
    </div>
  );
}

/** 审批线批清单:空态分档 + 加载中 + 批次行列表(降分支拆件)。 */
function BatchListView({
  state,
  cwd,
  sessionId,
  tmdSessionId,
  busy,
  confirm,
  setConfirm,
  actions,
}: {
  state: CwdCkptState;
  cwd: string | null;
  sessionId: string | null;
  tmdSessionId: string | undefined;
  busy: boolean;
  confirm: ConfirmTarget | null;
  setConfirm: (v: ConfirmTarget | null) => void;
  actions: {
    doApprove: (batchId: string) => Promise<void>;
    doRevert: (batchId: string, paths?: string[]) => Promise<void>;
    doApply: (batchId: string) => Promise<void>;
    doUndo: (batchId: string) => Promise<void>;
  };
}) {
  if (!cwd) return <Empty text={t("暂无活跃工作区")} />;
  if (!sessionId) return <Empty text={t("审批线跟随会话生命周期 —— 当前工作区没有活会话")} />;
  if (state.notARepo) {
    return <Empty text={t("非 git 工作区 —— 仅声明写入事件检测的 CLI(如 claude)可在此记账,其余 CLI 需 git 仓库")} />;
  }
  if (state.loading && state.batches.length === 0) {
    return (
      <div className="flex items-center justify-center gap-2 pt-10 text-(--tmd-fg-faint)">
        <CircleNotch size="0.8125rem" className="animate-spin" aria-hidden /> {t("读取批次…")}
      </div>
    );
  }
  if (state.batches.length === 0) {
    /* 错误横幅已说明原因,不再叠加误导性空态 */
    if (state.error) return null;
    return <Empty text={t("本会话还没有批次 —— 发送一条让 AI 改文件的消息后,这里会按轮归批")} />;
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto py-2 pr-1 pl-0.5">
      {state.batches.map((b, i) => (
        <BatchRow
          key={b.id}
          batch={b}
          last={i === state.batches.length - 1}
          busy={busy}
          confirm={confirm?.batchId === b.id ? confirm : null}
          setConfirm={setConfirm}
          onApprove={actions.doApprove}
          onRevert={actions.doRevert}
          onApply={actions.doApply}
          onUndo={actions.doUndo}
          cwd={cwd}
          sessionId={sessionId}
          tmdSessionId={tmdSessionId}
        />
      ))}
    </div>
  );
}

/** 操作结果通知条:点击关闭(降分支拆件)。 */
function PanelNoticeBanner({ notice, onClose }: { notice: string; onClose: () => void }) {
  return (
    <button
      type="button"
      className="flex-none border-b border-(--tmd-border) bg-(--tmd-accent)/10 px-3 py-1.5 text-left text-[0.6875rem] text-(--tmd-fg-muted) hover:underline"
      onClick={onClose}
    >
      {notice} · {t("点击关闭")}
    </button>
  );
}

/** 清单刷新失败横幅 —— 必须与「没有批次」可区分(降分支拆件):此前错误被吞进
    空态,一次瞬时失败(git 并发/IPC 抖动)就会显示成「本会话还没有批次」。 */
function PanelErrorBanner({
  error,
  onRetry,
}: {
  error: string;
  onRetry: () => void;
}) {
  return (
    <button
      type="button"
      className="flex-none border-b border-(--tmd-border) bg-(--tmd-diff-removed)/10 px-3 py-1.5 text-left text-[0.6875rem] text-(--tmd-diff-removed) hover:underline"
      onClick={onRetry}
    >
      {t("审批线清单刷新失败:{error} · 点击重试", { error: error.replace(/^E_\w+:\s*/, "") })}
    </button>
  );
}

export function CheckpointsPanel() {
  const { cwd, sessionId, tmdSessionId, shown } = useCkptScope();
  useCkptAutoRefresh(cwd, sessionId, tmdSessionId);

  const state = useCkptBatches(cwd, sessionId);
  const [confirm, setConfirm] = useState<ConfirmTarget | null>(null);
  /* 页签:审批线 | 时间线(时间线是独立组件,与审批线零共享逻辑) */
  const [view, setView] = useState<"batch" | "timeline">("batch");
  const actions = useCheckpointActions(cwd, sessionId, tmdSessionId);
  const { busy, notice, setNotice } = actions;

  const pendingCount = state.batches.filter((b) => !b.open && b.state === "pending").length;

  return (
    <div className="flex h-full flex-col bg-(--tmd-bg-base)">
      <PanelSummaryBar view={view} onView={setView} shown={shown} pendingCount={pendingCount} />

      {view === "batch" && notice && (
        <PanelNoticeBanner notice={notice} onClose={() => setNotice(null)} />
      )}

      {/* 清单刷新失败横幅:点击重拉;失败期间已保留旧清单,时间线照常可读可操作。 */}
      {view === "batch" && state.error && !state.notARepo && cwd && sessionId && (
        <PanelErrorBanner
          error={state.error}
          onRetry={() => void refreshBatches(cwd, sessionId, tmdSessionId)}
        />
      )}

      {view === "batch" ? (
        <BatchListView
          state={state}
          cwd={cwd}
          sessionId={sessionId}
          tmdSessionId={tmdSessionId}
          busy={busy}
          confirm={confirm}
          setConfirm={setConfirm}
          actions={actions}
        />
      ) : (
        <TimelinePanel />
      )}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="px-4 pt-10 text-center text-[0.6875rem] leading-relaxed text-(--tmd-fg-faint)">
      {text}
    </div>
  );
}

/** segmented 页签按钮态 —— 平滑紧凑:无外框无底槽,选中仅软底色(无内阴影)。 */
function segCls(on: boolean): string {
  return `flex items-center gap-1 rounded px-1.5 text-[0.6875rem] leading-[1.125rem] ${
    on ? "bg-(--tmd-bg-hover) font-semibold text-(--tmd-fg)" : "text-(--tmd-fg-faint) hover:text-(--tmd-fg)"
  }`;
}
