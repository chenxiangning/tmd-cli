/**
 * CheckpointsPanel —— 右栏「审批线」时间线(spec §4,D 主形态)。
 *
 * 结构:摘要行(项目 + 待审数)→ 通知条 → 时间线(批次行见 BatchRow.tsx,
 * 文件规模铁则拆分)。动作处理器(doApprove/doRevert/doApply/doUndo)在此;
 * 回退/应用共用内联确认卡(mode 区分,渲染在 BatchRow)。
 */

import { useEffect, useReducer, useState } from "react";
import { ClockClockwise, ClockCounterClockwise, CircleNotch } from "@phosphor-icons/react";
import { host } from "@kernel/host";
import { KernelTopics } from "@kernel/events";
import { t } from "@kernel/i18n";
import { useWorkspaces } from "@kernel/workspace";
import { checkpointIdentity } from "./identity";
import { BatchRow, type ConfirmTarget } from "./BatchRow";
import { TimelineCount, TimelinePanel } from "./TimelinePanel";
import {
  applyBatch,
  approveBatch,
  pruneRetention,
  refreshBatches,
  revertBatch,
  sealDeadTurns,
  undoRevertBatch,
  useCkptBatches,
} from "./store";

const POLL_MS = 6000;

export function CheckpointsPanel() {
  const { list, activeId } = useWorkspaces();
  const active = list.find((w) => w.id === activeId) ?? list[0];
  /* 会话严格绑定:只认当前活跃会话(审批线生命周期 = 单个会话)。
     读写同键:锚点按 session.cwd 落账(index.tsx captureAnchor),查询也必须
     用 session.cwd —— 点选他工作区会话并不切 activeId(仅工作区卡片点击才切),
     用活跃工作区根会查错账本;活跃工作区恰好非 git 时谎报 E_NOT_A_REPO
     (2026-09-09 实证:er-qi 活跃 + 选中 tmd-cli 会话 → 审批线空态,账目其实在
     tmd-cli 账本)。无会话时回落活跃工作区根(sealDeadTurns 强退恢复需 cwd)。
     身份统一经 identity.ts 仲裁:cli 身份被多个活会话争持(绑定竞态)时先创建者
     保留、后到者回退 tmd id;首条 prompt 时身份常未绑上(锚点暂记 tmd id 名下),
     查询把 tmd id 作为副键一并命中,后端自动回填。 */
  const [, bumpRender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const offs = [
      host.events.on(KernelTopics.activeSessionChanged, bumpRender),
      host.events.on(KernelTopics.sessionsChanged, bumpRender),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  const activeSessionId = host.getActiveSessionId();
  const identity = activeSessionId ? checkpointIdentity(activeSessionId) : null;
  const cwd = identity?.cwd ?? active?.root ?? null;
  const sessionId = identity?.key ?? null;
  const tmdSessionId = activeSessionId ?? undefined;
  /* 徽标与查询同口径:会话 cwd 落在哪个工作区根下就显示哪个,防错配误导。 */
  const shown = cwd ? (list.find((w) => cwd === w.root || cwd.startsWith(`${w.root}/`)) ?? active) : active;

  const state = useCkptBatches(cwd, sessionId);
  const [confirm, setConfirm] = useState<ConfirmTarget | null>(null);
  /* 页签:审批线 | 时间线(时间线是独立组件,与审批线零共享逻辑) */
  const [view, setView] = useState<"batch" | "timeline">("batch");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!cwd) return;
    pruneRetention(cwd);
    /* 强退恢复先于首拉:上一运行的开放锚点在此代为封口,恢复出的批随
       紧跟的这次 refresh 一并上时间线(每 cwd 每运行一次,失败可重收)。 */
    if (!sessionId) {
      void sealDeadTurns(cwd);
      return;
    }
    void sealDeadTurns(cwd).then(() => refreshBatches(cwd, sessionId, tmdSessionId));
    const timer = window.setInterval(() => void refreshBatches(cwd, sessionId, tmdSessionId), POLL_MS);
    return () => window.clearInterval(timer);
  }, [cwd, sessionId, tmdSessionId]);

  const pendingCount = state.batches.filter((b) => !b.open && b.state === "pending").length;

  async function doApprove(batchId: string) {
    if (!cwd || !sessionId) return;
    setBusy(true);
    try {
      await approveBatch(cwd, batchId);
      setNotice(t("批次已标记通过 —— 仅记录状态,不影响任何文件"));
    } catch (e) {
      setNotice(String(e).replace(/^E_\w+:\s*/, ""));
    } finally {
      setBusy(false);
      void refreshBatches(cwd, sessionId, tmdSessionId);
    }
  }

  async function doRevert(batchId: string, paths?: string[]) {
    if (!cwd || !sessionId) return;
    setBusy(true);
    try {
      const out = await revertBatch(cwd, batchId, paths);
      const n = out.restored.length + out.deleted.length;
      const skipped = out.skipped.map((s) => `${s.path}(${s.reason})`).join("、");
      setNotice(
        skipped
          ? t("已回退 {n} 个文件;跳过:{skipped}", { n, skipped })
          : t("已回退 {n} 个路径 · 恢复点已留存,可反悔", { n }),
      );
    } catch (e) {
      setNotice(String(e).replace(/^E_\w+:\s*/, ""));
    } finally {
      setBusy(false);
      void refreshBatches(cwd, sessionId, tmdSessionId);
    }
  }

  async function doApply(batchId: string) {
    if (!cwd || !sessionId) return;
    setBusy(true);
    try {
      const out = await applyBatch(cwd, batchId);
      const n = out.restored.length;
      const skipped = out.skipped.map((s) => `${s.path}(${s.reason})`).join("、");
      setNotice(
        n > 0
          ? skipped
            ? t("已应用 {n} 个文件;跳过:{skipped}", { n, skipped })
            : t("已应用 {n} 个文件 · 恢复点已留存,可反悔", { n })
          : skipped
            ? t("没有可应用的文件;跳过:{skipped}", { skipped })
            : t("没有可应用的文件"),
      );
    } catch (e) {
      setNotice(String(e).replace(/^E_\w+:\s*/, ""));
    } finally {
      setBusy(false);
      void refreshBatches(cwd, sessionId, tmdSessionId);
    }
  }

  async function doUndo(batchId: string) {
    if (!cwd || !sessionId) return;
    setBusy(true);
    try {
      const out = await undoRevertBatch(cwd, batchId);
      setNotice(t("已从恢复点恢复 {n} 个文件,批次回到待审", { n: out.restored.length }));
    } catch (e) {
      setNotice(String(e).replace(/^E_\w+:\s*/, ""));
    } finally {
      setBusy(false);
      void refreshBatches(cwd, sessionId, tmdSessionId);
    }
  }

  return (
    <div className="flex h-full flex-col bg-(--tmd-bg-base)">
      {/* 摘要行 —— 字号对齐面板体系(11px 为主),项目名用扁平标签非胶囊 */}
      <div className="flex h-[30px] flex-none items-center gap-2 border-b border-(--tmd-border) bg-(--tmd-bg-elevated) px-2.5 text-[0.6875rem]">
        <div className="flex flex-none items-center gap-0.5">
          <button type="button" onClick={() => setView("batch")} className={segCls(view === "batch")}>
            <ClockClockwise size="0.6875rem" aria-hidden />
            {t("审批线")}
          </button>
          <button type="button" onClick={() => setView("timeline")} className={segCls(view === "timeline")}>
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

      {view === "batch" && notice && (
        <button
          type="button"
          className="flex-none border-b border-(--tmd-border) bg-(--tmd-accent)/10 px-3 py-1.5 text-left text-[0.6875rem] text-(--tmd-fg-muted) hover:underline"
          onClick={() => setNotice(null)}
        >
          {notice} · {t("点击关闭")}
        </button>
      )}

      {/* 清单刷新失败:必须与「没有批次」可区分 —— 此前错误被吞进空态,
          一次瞬时失败(git 并发/IPC 抖动)就会显示成「本会话还没有批次」。
          点击横幅重拉;失败期间已保留旧清单,时间线照常可读可操作。 */}
      {view === "batch" && state.error && !state.notARepo && cwd && sessionId && (
        <button
          type="button"
          className="flex-none border-b border-(--tmd-border) bg-(--tmd-diff-removed)/10 px-3 py-1.5 text-left text-[0.6875rem] text-(--tmd-diff-removed) hover:underline"
          onClick={() => void refreshBatches(cwd, sessionId, tmdSessionId)}
        >
          {t("审批线清单刷新失败:{error} · 点击重试", { error: state.error.replace(/^E_\w+:\s*/, "") })}
        </button>
      )}

      {view === "batch" ? (
      <div className="min-h-0 flex-1 overflow-y-auto py-2 pr-1 pl-0.5">
        {!cwd ? (
          <Empty text={t("暂无活跃工作区")} />
        ) : !sessionId ? (
          <Empty text={t("审批线跟随会话生命周期 —— 当前工作区没有活会话")} />
        ) : state.notARepo ? (
          <Empty text={t("非 git 工作区 —— 仅声明写入事件检测的 CLI(如 claude)可在此记账,其余 CLI 需 git 仓库")} />
        ) : state.loading && state.batches.length === 0 ? (
          <div className="flex items-center justify-center gap-2 pt-10 text-(--tmd-fg-faint)">
            <CircleNotch size="0.8125rem" className="animate-spin" aria-hidden /> {t("读取批次…")}
          </div>
        ) : state.batches.length === 0 ? (
          state.error ? null /* 错误横幅已说明原因,不再叠加误导性空态 */ : (
            <Empty text={t("本会话还没有批次 —— 发送一条让 AI 改文件的消息后,这里会按轮归批")} />
          )
        ) : (
          state.batches.map((b, i) => (
            <BatchRow
              key={b.id}
              batch={b}
              last={i === state.batches.length - 1}
              busy={busy}
              confirm={confirm?.batchId === b.id ? confirm : null}
              setConfirm={setConfirm}
              onApprove={doApprove}
              onRevert={doRevert}
              onApply={doApply}
              onUndo={doUndo}
              cwd={cwd}
              sessionId={sessionId}
              tmdSessionId={tmdSessionId}
            />
          ))
        )}
      </div>
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
