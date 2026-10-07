/**
 * 标注存证 join 作用域(W2)—— evidence 纯函数与 checkpoints 批清单/diff 缓存的粘合层。
 * 面板渲染时 join:锚点 marksRefs × 批 patch(diffCache 懒取暖缓存)× 批状态,
 * 回退联动降级 = 派生口径天然免费(批翻 reverted 即不再计入)。
 *
 * 跨插件消费先例:经兄弟插件声明的具名数据函数窄口读写
 * (checkpoints store 的 getCkptBatches/refreshBatches/useCkptVersion、diffCache 的
 * getCachedDiff/loadDiff、identity 的 checkpointIdentity;先例 = daily-journal
 * 消费 marks store staged/sent,架构文档 app 树例外条款)。
 * join 域 = 活跃会话批清单(与右栏审批线同口径,切 tab 即切语境);
 * 已退出会话的历史批不追(天花板见 evidence.ts 头注)。
 */

import { useEffect, useMemo } from "react";
import { host } from "@kernel/host";
import { KernelTopics } from "@kernel/events";
import { usePanelActive } from "@kernel/panelActivity";
import { t } from "@kernel/i18n";
import type { CkptBatch } from "@kernel/ipc";
import { openBatchTab } from "../checkpoints/batchTab";
import { getCkptBatches, refreshBatches, useCkptVersion } from "../checkpoints/store";
import { getCachedDiff, getCachedDiffError, loadDiff } from "../checkpoints/diffCache";
import { checkpointIdentity } from "../checkpoints/identity";
import { verdictFor, type RoundInput, type RoundVerdict } from "./evidence";

/** 审批线 6s 轮询同节拍:批封口/回退后徽章最迟一拍内跟上。 */
const POLL_MS = 6000;

/** 标注卡参与轮次行的一条:判定值 + 可跳批审阅单的批句柄。 */
export interface MarkRound {
  verdict: RoundVerdict;
  batch: CkptBatch;
}

/** 活跃会话作用域(与 useCkptScope.resolveScope 同律:会话 cwd 落账,查询同键;
 *  差异:那边无会话时回落工作区根供 sealDeadTurns,这边返 null 即空域 —— 徽章
 *  只评活跃会话,勿「统一」成工作区根,否则退出中会话的批会串进当前面板)。 */
function scopeOf(): { cwd: string | null; sessionId: string | null; tmdSessionId?: string } {
  const activeSessionId = host.getActiveSessionId();
  const identity = activeSessionId ? checkpointIdentity(activeSessionId) : null;
  return { cwd: identity?.cwd ?? null, sessionId: identity?.key ?? null, tmdSessionId: activeSessionId ?? undefined };
}

/**
 * 返回 per-mark 轮次查询(渲染期同步 join)。未命中的批 diff 自动暖缓存
 * (loadDiff 完成后 store emit,useCkptVersion 触发重渲染补判定)。
 */
export function useMarkRounds(): {
  roundsFor: (mark: { id: string; startLine: number; endLine: number }) => MarkRound[];
  openRoundBatch: (batch: CkptBatch, focusPath: string) => void;
} {
  const version = useCkptVersion();
  const panelActive = usePanelActive();

  useEffect(() => {
    /* 轮询走 bump()(内部现读 scopeOf):interval 闭包不得捕获挂载时的
       cwd/sessionId —— 切会话后旧键持续轮询,新会话批态停更(评审 P1)。 */
    const bump = () => {
      const s = scopeOf();
      if (s.cwd && s.sessionId) void refreshBatches(s.cwd, s.sessionId, s.tmdSessionId);
    };
    bump();
    const off1 = host.events.on(KernelTopics.activeSessionChanged, bump);
    const off2 = host.events.on(KernelTopics.sessionsChanged, bump);
    const timer = window.setInterval(() => {
      if (panelActive) bump();
    }, POLL_MS);
    return () => {
      off1();
      off2();
      window.clearInterval(timer);
    };
  }, [panelActive]);

  const roundsFor = useMemo(() => {
    const { cwd, sessionId } = scopeOf();
    if (!cwd || !sessionId) return () => [];
    const batches = getCkptBatches(cwd, sessionId).batches;
    return (mark: { id: string; startLine: number; endLine: number }) => {
      const out: MarkRound[] = [];
      for (const b of batches) {
        const ref = b.marksRefs.find((r) => r.markId === mark.id);
        if (!ref) continue;
        /* patch 只认 M 类非二进制:新建(A)与标记先行存在矛盾,删除(D)走标记 lost */
        const modifiable = b.files.some((f) => f.path === ref.path && f.status === "M");
        let patch: string | null = null;
        if (!b.open && modifiable) {
          const diffs = getCachedDiff(cwd, sessionId, b.id);
          if (diffs !== undefined) {
            patch = diffs.find((d) => d.path === ref.path && !d.binary)?.patch ?? null;
          } else if (getCachedDiffError(cwd, sessionId, b.id) === null) {
            /* 在途查证:略片不闪「未改写」—— 回包 emit 后 version bump 补判。
               拉取已失败(error 置位)则按未改写落定:错误明细归批审阅面,
               此处不重试 —— emit→loadDiff→emit 会成失败重试风暴。 */
            loadDiff(cwd, sessionId, b.id);
            continue;
          }
        }
        const round: RoundInput = {
          open: b.open,
          reverted: b.state === "reverted" || b.files.some((f) => f.path === ref.path && f.reverted),
          carried: true,
          patch,
        };
        const verdict = verdictFor(mark, round);
        if (verdict) out.push({ verdict, batch: b });
      }
      return out;
    };
    // version 进依赖:批清单与 diff 缓存任何变更都重算 join
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  /* 参与轮次反查:开中央批审阅单(既有面,深链滚动到标记文件分区)。 */
  const openRoundBatch = (batch: CkptBatch, focusPath: string) => {
    const { cwd, sessionId, tmdSessionId } = scopeOf();
    if (!cwd || !sessionId) return;
    openBatchTab({ cwd, sessionId, tmdSessionId, batchId: batch.id, title: t("批次 #{index}", { index: batch.index }), focusPath });
  };
  return { roundsFor, openRoundBatch };
}
