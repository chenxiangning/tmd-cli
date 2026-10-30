/**
 * CheckpointsPanel 作用域钩子 —— 会话身份解析 + 面板级刷新调度
 * (no-high-complexity 降分支):身份仲裁细则收拢在此,面板组件只留
 * 页签状态与渲染分支。
 */

import { useEffect, useReducer, useRef } from "react";
import { usePanelActive } from "@kernel/panelActivity";
import { host } from "@kernel/host";
import { KernelTopics } from "@kernel/events";
import { useWorkspaces } from "@kernel/workspace";
import { checkpointIdentity, echoProbing, staleFallbackKey, withEchoFallback } from "./identity";
import { pruneRetention, sealDeadTurns } from "./retention";
import { hasCkptEntry, refreshBatches, touchCkptKey } from "./store";

const POLL_MS = 6000;

export function useCkptScope() {
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
    const off1 = host.events.on(KernelTopics.activeSessionChanged, bumpRender);
    const off2 = host.events.on(KernelTopics.sessionsChanged, bumpRender);
    const off3 = host.events.on(KernelTopics.cliIdentityProbe, bumpRender);
    return () => {
      off1();
      off2();
      off3();
    };
  }, []);

  /* 闭包类型随 useWorkspaces/checkpointIdentity 就地推导(store 契约未导出,不为其开口)。 */
  /* 键翻转沿跟踪(effect 侧落账,渲染读上一拍值):主键翻转的新键首拉未落地时
     回落上一主键(stale-while-key-flip,见 staleFallbackKey)—— 开窗沿与
     关窗/重绑沿对称,重绑未首拉不再闪一拍空帧。 */
  const prevKeyRef = useRef<{ tmd: string | null; key: string | null }>({ tmd: null, key: null });
  const resolveScope = () => {
    const activeSessionId = host.getActiveSessionId();
    const identity = activeSessionId ? checkpointIdentity(activeSessionId) : null;
    /* 读侧与写侧(identity.ts)同律:探测窗内绑定值不可信,查询键回落 tmd id,
       重绑后 backfill_identity 整链自愈 —— 窗内面板不再读到旧绑定名下的账。 */
    const probing = echoProbing(activeSessionId);
    const key = identity ? withEchoFallback(identity, probing).key : null;
    const prev = prevKeyRef.current;
    const staleSessionId = staleFallbackKey({
      tmdId: activeSessionId ?? null,
      prevTmdId: prev.tmd,
      prevKey: prev.key,
      resolvedKey: key,
      hasCurrent: hasCkptEntry(identity?.cwd ?? null, key),
    });
    return {
      cwd: identity?.cwd ?? active?.root ?? null,
      sessionId: key,
      tmdSessionId: activeSessionId ?? undefined,
      /* 翻沿的上一主键:回落读/翻沿种子双用,同 tmd 会话内才有效(防串账)。 */
      staleSessionId,
    };
  };
  const { cwd, sessionId, tmdSessionId, staleSessionId } = resolveScope();
  useEffect(() => {
    const key = sessionId;
    if (key) prevKeyRef.current = { tmd: host.getActiveSessionId(), key };
  }, [sessionId]);

  /* 徽标与查询同口径:会话 cwd 落在哪个工作区根下就显示哪个,防错配误导。 */
  const shown = cwd ? (list.find((w) => cwd === w.root || cwd.startsWith(`${w.root}/`)) ?? active) : active;

  return { cwd, sessionId, tmdSessionId, staleSessionId, shown };
}

/** 面板级刷新:留存修剪 + 强退恢复 + 批清单轮询(no-high-complexity 降分支)。 */
export function useCkptAutoRefresh(
  cwd: string | null,
  sessionId: string | null,
  tmdSessionId: string | undefined,
  staleSessionId?: string | null,
) {
  const panelActive = usePanelActive();
  useEffect(() => {
    if (!cwd) return;
    pruneRetention(cwd);
    /* 回落键在读期间保持 LRU 新鲜(挂载拍 + 每轮询拍触碰)。 */
    if (staleSessionId) touchCkptKey(cwd, staleSessionId);
    /* 强退恢复先于首拉:上一运行的开放锚点在此代为封口,恢复出的批随
       紧跟的这次 refresh 一并上时间线(每 cwd 每运行一次,失败可重收)。 */
    if (!sessionId) {
      void sealDeadTurns(cwd);
      return;
    }
    void sealDeadTurns(cwd).then(() => refreshBatches(cwd, sessionId, tmdSessionId, staleSessionId));
    const timer = window.setInterval(
      () => {
        if (staleSessionId) touchCkptKey(cwd, staleSessionId);
        if (panelActive) void refreshBatches(cwd, sessionId, tmdSessionId, staleSessionId);
      },
      POLL_MS,
    );
    return () => window.clearInterval(timer);
  }, [cwd, sessionId, tmdSessionId, staleSessionId, panelActive]);
}
