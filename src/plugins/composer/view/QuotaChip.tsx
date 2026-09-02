/**
 * Quota chip ─ 内嵌 composer 工具栏的额度指示。
 *
 * 渲染(当前激活 CLI session):
 * - 窗口型供应商: 额度 5h [▓▓░] 42%  7d [▓░░] 18%  (支持几个窗口展示几个)
 * - 余额型供应商(deepseek/中转站): 额度 ¥12.50
 * - 加载中: 额度 …;失败: 额度 !(同模型保留上次成功数据,仅加警示)
 * - 模型切换: 旧供应商数据立即作废,按新模型重新抓取(任意 CLI 统一)
 * - 无 session / 无 provider: 不渲染(不猜)
 *
 * 交互: 点击 chip = 弹出额度详情小弹窗(各窗口用量 + 下次刷新时间 + 余额);
 *      弹窗内 ⟳ 按钮 = 手动刷新;Esc / 点遮罩 / 再点 chip = 关闭。
 * 弹窗: portal 挂 document.body + fixed 定位(复刻 panel-overflow 模式),
 *      跳出 composer 层叠上下文,杜绝被幕布压住。
 * 数据: kernel/quota.ts 注册点;HTTP 调用走 cli-shared/quota/vendors.ts。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RefreshCw } from "lucide-react";
import { host, useHost } from "@kernel/host";
import { getQuotaProvider, SHORT_WINDOW_LABEL, type QuotaSnapshot } from "@kernel/quota";
import { formatRelativeTime, formatResetAt } from "@kernel/relativeTime";

/** ms epoch → "14:30:05"(弹窗底部"更新于")。 */
function formatClock(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 空快照(占位):模型切换后旧供应商数据立即作废,新抓取落地前 chip 显示 "额度 …"。 */
function emptyQuotaSnapshot(profileId: string): QuotaSnapshot {
  return {
    providerLabel: profileId,
    title: `${profileId.toUpperCase()} 额度`,
    usedLabel: "已使用",
    windows: [],
  };
}

/** 当前激活 session 的 CLI quota。 */
function useActiveQuota(): {
  snapshot: QuotaSnapshot | null;
  loading: boolean;
  /** 最近一次抓取完成时刻(ms epoch);null = 尚未抓取。 */
  fetchedAt: number | null;
  refresh: () => void;
} {
  useHost();
  const sessionId = host.getActiveSessionId();
  const session = sessionId ? host.getSessions().find((s) => s.id === sessionId) : null;
  const profileId = session?.profileId;
  const model = sessionId ? (host.getSessionStatus(sessionId)?.model ?? null) : null;

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

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!profileId) {
      setEntry(null);
      return;
    }
    const provider = getQuotaProvider(profileId);
    if (!provider) {
      setEntry({
        model,
        snapshot: { ...emptyQuotaSnapshot(profileId), error: "暂不支持额度查询" },
      });
      return;
    }
    setEntry((prev) =>
      prev?.model === model ? prev : { model, snapshot: emptyQuotaSnapshot(profileId) },
    );
    setLoading(true);
    provider
      .fetch({ model })
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
                  error: e instanceof Error ? e.message : String(e),
                },
              }
            : prev,
        ),
      )
      .finally(() => {
        setFetchedAt(Date.now());
        setLoading(false);
      });
  }, [profileId, model, session?.workspaceId, tick]);

  return { snapshot: entry?.snapshot ?? null, loading, fetchedAt, refresh };
}

/**
 * 额度详情弹窗 ── 点击 QuotaChip 弹出。
 * 每个窗口一行:标签 + 进度条 + 已用百分比,下一行给下次刷新时间(绝对 + 相对)。
 * 底部:最近抓取时刻 + 手动刷新按钮。
 */
function QuotaDetailPopover({
  snapshot,
  loading,
  fetchedAt,
  position,
  onRefresh,
  onClose,
}: {
  snapshot: QuotaSnapshot;
  loading: boolean;
  fetchedAt: number | null;
  position: { x: number; bottom: number };
  onRefresh: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <>
      <div className="panel-overflow-backdrop" onClick={onClose} />
      <div
        className="quota-popover"
        style={{ left: position.x, bottom: position.bottom }}
        role="dialog"
        aria-label={snapshot.title}
      >
        <div className="quota-popover-header">
          <span>{snapshot.title}</span>
          {snapshot.planLabel ? (
            <span className="quota-popover-plan">{snapshot.planLabel}</span>
          ) : null}
        </div>

        {snapshot.windows.map((w) => (
          <div key={w.label} className="quota-popover-window">
            <div className="quota-popover-window-head">
              <span className="quota-popover-window-label">{w.label}</span>
              <span className="quota-popover-bar">
                <span
                  className="quota-popover-fill"
                  style={{ width: `${w.displayPercent}%` }}
                />
              </span>
              <span className="quota-popover-pct">
                {snapshot.usedLabel} {w.displayPercent}%
              </span>
            </div>
            {w.resetsAt ? (
              <div className="quota-popover-reset">
                下次刷新: {formatResetAt(w.resetsAt)} · {formatRelativeTime(w.resetsAt)}
              </div>
            ) : null}
          </div>
        ))}

        {snapshot.balanceText ? (
          <div className="quota-popover-balance">余额: {snapshot.balanceText}</div>
        ) : null}

        {snapshot.error ? (
          <div className="quota-popover-error">{snapshot.error}</div>
        ) : null}

        <div className="quota-popover-footer">
          <span>{fetchedAt ? `更新于 ${formatClock(fetchedAt)}` : "尚未加载"}</span>
          <button
            type="button"
            className="quota-popover-refresh"
            onClick={onRefresh}
            title="重新抓取额度"
          >
            <RefreshCw size={11} aria-hidden className={loading ? "is-spinning" : undefined} />
            刷新
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}

export function QuotaChip() {
  const { snapshot, loading, fetchedAt, refresh } = useActiveQuota();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ x: number; bottom: number } | null>(null);
  const chipRef = useRef<HTMLSpanElement>(null);

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
      <span
        ref={chipRef}
        className={`quota-chip${snapshot.error ? " is-error" : ""}`}
        title="点击查看额度详情"
        role="button"
        tabIndex={0}
        aria-label={`${snapshot.title},点击查看详情`}
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          toggle();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
          }
        }}
      >
        额度
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
      </span>
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
