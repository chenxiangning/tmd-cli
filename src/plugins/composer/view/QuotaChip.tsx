/**
 * Quota chip ─ 内嵌 composer 工具栏的额度指示(详情弹窗拆至 QuotaPopover.tsx)。
 *
 * 渲染(当前激活 CLI session;或 source 覆写 —— 结构化会话工具条同 chip):
 * - 窗口型供应商: 额度 5h [▓▓░] 42%  7d [▓░░] 18%  (支持几个窗口展示几个)
 * - 余额型供应商(deepseek/中转站): 额度 ¥12.50
 * - 加载中: 额度 …;失败: 额度 !(同模型保留上次成功数据,仅加警示)
 * - 模型切换: 旧供应商数据立即作废,按新模型重新抓取(任意 CLI 统一)
 * - 无 session / 无 provider: 不渲染(不猜)
 *
 * 交互: 点击 chip = 弹出额度详情小弹窗(各窗口用量 + 下次刷新时间 + 余额);
 *      弹窗内 ⟳ 按钮 = 手动刷新;Esc / 点遮罩 / 再点 chip = 关闭。
 * 数据: kernel/quota.ts 注册点;HTTP 调用走 cli-shared/quota/vendors.ts。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { errTextDisplay } from "@kernel/errText";
import { host, useHost } from "@kernel/host";
import { t } from "@kernel/i18n";
import { getQuotaProvider, SHORT_WINDOW_LABEL, type QuotaSnapshot } from "@kernel/quota";
import { resolveQuotaIdentity, type QuotaChipSource } from "./quotaIdentity";
import { QuotaDetailPopover } from "./QuotaPopover";

/** 空快照(占位):模型切换后旧供应商数据立即作废,新抓取落地前 chip 显示 "额度 …"。 */
function emptyQuotaSnapshot(profileId: string): QuotaSnapshot {
  return {
    providerLabel: profileId,
    title: t("{id} 额度", { id: profileId.toUpperCase() }),
    usedLabel: t("已使用") as "已使用" | "已剩余",
    windows: [],
  };
}

/** 当前激活 session 的 CLI quota(source 覆写见 quotaIdentity 的 QuotaChipSource)。
 *  供应商额度是账号级(HTTP 按模型查询),远程引擎会话同样回填(凭据取本机登录态,
 *  同一供应商账号即代表)。 */
function useActiveQuota(source?: Partial<QuotaChipSource>): {
  snapshot: QuotaSnapshot | null;
  loading: boolean;
  /** 最近一次抓取完成时刻(ms epoch);null = 尚未抓取。 */
  fetchedAt: number | null;
  refresh: () => void;
} {
  useHost();
  const sessionId = host.getActiveSessionId();
  const session = sessionId ? host.getSessions().find((s) => s.id === sessionId) : null;
  const identity = resolveQuotaIdentity(
    source,
    sessionId,
    session,
    sessionId ? host.getSessionStatus(sessionId)?.model : undefined,
    sessionId ? host.getCliSessionId(sessionId) : undefined,
  );
  const { profileId, model, cwd, cliSessionId } = identity;

  /* 快照与路由模型同存同灭(任意 CLI 统一语义):
     - 模型切换 → 旧快照归属旧供应商,立即作废换占位并重新抓取,绝不跨模型混搭显示;
     - 抓取乱序/过期(快速连切)→ 按模型标签丢弃,不得覆盖当前模型的占位/数据;
     - 同模型刷新失败 → 保留旧数据,error 仅作警示样式与 tooltip 原因。 */
  const [entry, setEntry] = useState<{
    model: string | null;
    snapshot: QuotaSnapshot;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  /* 手动 ⟳ 置位,下一次 effect 抓取消费:绕过共享快照缓存读(批二评审 P1)。 */
  const forceRef = useRef(false);
  /* 请求序守卫:被取代的抓取(快速 ⟳ 连点/换模型)不得在 finally 里提前复位
     loading/fetchedAt(2026-09-28 评审 F5)。 */
  const fetchSeqRef = useRef(0);

  const refresh = useCallback(() => {
    forceRef.current = true;
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    const seq = ++fetchSeqRef.current;
    const force = forceRef.current;
    forceRef.current = false;
    if (!profileId) {
      setEntry(null);
      setFetchedAt(null);
      setLoading(false);
      return;
    }
    const provider = getQuotaProvider(profileId);
    if (!provider) {
      setEntry({
        model,
        snapshot: { ...emptyQuotaSnapshot(profileId), error: t("暂不支持额度查询") },
      });
      /* 早退分支是刚 ++ 过的当次最新序,直接复位即可;被取代的旧 fetch
         由下方 seq 闸拦下,不会回写。不复位 = 切到无 provider 会话后
         loading 永卡 true、「更新于」残留上一供应商时刻(2026-09-28 三轮)。 */
      setFetchedAt(null);
      setLoading(false);
      return;
    }
    setEntry((prev) =>
      prev?.model === model ? prev : { model, snapshot: emptyQuotaSnapshot(profileId) },
    );
    setLoading(true);
    provider
      .fetch({ model, cwd, cliSessionId, force })
      .then((snapshot) =>
        setEntry((prev) => (prev?.model === model ? { model, snapshot } : prev)),
      )
      .catch((e: unknown) =>
        setEntry((prev) =>
          prev?.model === model
            ? {
                model,
                snapshot: {
                  ...prev.snapshot,
                  error: errTextDisplay(e),
                },
              }
            : prev,
        ),
      )
      .finally(() => {
        if (seq !== fetchSeqRef.current) return;
        setFetchedAt(Date.now());
        setLoading(false);
      });
  }, [profileId, model, cwd, cliSessionId, session?.workspaceId, tick]);

  return { snapshot: entry?.snapshot ?? null, loading, fetchedAt, refresh };
}

export function QuotaChip(source?: Partial<QuotaChipSource>) {
  const { snapshot, loading, fetchedAt, refresh } = useActiveQuota(source);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ x: number; bottom: number } | null>(null);
  const chipRef = useRef<HTMLButtonElement>(null);


  if (!snapshot) return null;

  const toggle = () => {
    if (!open && chipRef.current) {
      const rect = chipRef.current.getBoundingClientRect();
      /* 弹窗向上展开(composer 在窗口底部);x 右夹紧,防止超出窗口右缘。 */
      const x = Math.max(8, Math.min(rect.left, window.innerWidth - 280));
      setPosition({ x, bottom: window.innerHeight - rect.top + 6 });
    }
    setOpen((v) => !v);
  };

  return (
    <>
      <button
        type="button"
        ref={chipRef}
        className={`quota-chip${snapshot.error ? " is-error" : ""}`}
        title={t("点击查看额度详情")}
        aria-label={t("{title},点击查看详情", { title: snapshot.title })}
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          toggle();
        }}
      >
        {t("额度")}
        {loading && !snapshot.windows.length && !snapshot.balanceText && !snapshot.error ? (
          <span className="quota-chip-value">…</span>
        ) : snapshot.error && !snapshot.windows.length && !snapshot.balanceText ? (
          <span className="quota-chip-value">!</span>
        ) : (
          <>
            {snapshot.windows.map((w) => (
              <span key={w.label} className="quota-chip-window" style={{ display: "contents" }}>
                <span className="quota-chip-label">{SHORT_WINDOW_LABEL[w.label] ?? w.label}</span>
                <span className="quota-mini-bar">
                  <span className="quota-mini-fill" style={{ width: `${w.displayPercent}%` }} />
                </span>
                <span className="quota-chip-value">{w.displayPercent}%</span>
              </span>
            ))}
            {snapshot.windows.length === 0 && snapshot.balanceText ? (
              <span className="quota-chip-value">{snapshot.balanceText}</span>
            ) : null}
          </>
        )}
      </button>
      {open && position ? (
        <QuotaDetailPopover
          snapshot={snapshot}
          loading={loading}
          fetchedAt={fetchedAt}
          position={position}
          onRefresh={refresh}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
