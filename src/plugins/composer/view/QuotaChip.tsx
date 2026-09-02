/**
 * Quota chip ─ 内嵌 composer 工具栏的额度指示。
 *
 * 渲染(当前激活 CLI session):
 * - 窗口型供应商: 额度 5h [▓▓░] 42%  7d [▓░░] 18%  (支持几个窗口展示几个)
 * - 余额型供应商(deepseek/中转站): 额度 ¥12.50
 * - 加载中: 额度 …;失败: 额度 !
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
import { getQuotaProvider, type QuotaSnapshot } from "@kernel/quota";
import { formatRelativeTime } from "@kernel/relativeTime";

/** ms epoch → "9月5日 14:30"(下次刷新时间)。 */
function formatResetAt(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** ms epoch → "14:30:05"(弹窗底部"更新于")。 */
function formatClock(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 窗口长标签 → 工具栏短标。 */
const SHORT_LABEL: Record<string, string> = {
  "5小时": "5h",
  "7天": "7d",
  "1天": "1d",
  "30天": "30d",
};

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

  const [snapshot, setSnapshot] = useState<QuotaSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!profileId) {
      setSnapshot(null);
      return;
    }
    const provider = getQuotaProvider(profileId);
    if (!provider) {
      setSnapshot({
        providerLabel: profileId,
        title: `${profileId.toUpperCase()} 额度`,
        usedLabel: "已使用",
        windows: [],
        error: "暂不支持额度查询",
      });
      return;
    }
    setLoading(true);
    provider
      .fetch({ model })
      .then(setSnapshot)
      .catch((e: unknown) =>
        /* 瞬时失败(网络抖动/限流)不清空上次成功数据:保留旧窗口/余额,
           error 仅作警示样式与 tooltip 原因;首次即失败才显示 "!"。 */
        setSnapshot((prev) => ({
          providerLabel: profileId,
          title: prev?.title ?? `${profileId.toUpperCase()} 额度`,
          usedLabel: prev?.usedLabel ?? "已使用",
          windows: prev?.windows ?? [],
          balanceText: prev?.balanceText,
          planLabel: prev?.planLabel,
          error: e instanceof Error ? e.message : String(e),
        })),
      )
      .finally(() => {
        setFetchedAt(Date.now());
        setLoading(false);
      });
  }, [profileId, model, session?.workspaceId, tick]);

  return { snapshot, loading, fetchedAt, refresh };
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
                <span className="quota-chip-label">{SHORT_LABEL[w.label] ?? w.label}</span>
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
