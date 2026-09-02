/**
 * 引擎已登录供应商列表 —— welcome 页引擎卡下方的额度子区。
 *
 * 布局(v4,原型 docs/prototypes/welcome-quota-oneline.html):
 * - 每供应商 1 行 = 2 列网格: [定宽标题列] [窗口列],标题列定宽保证窗口列跨行同 x 起点;
 * - 窗口列内嵌 1fr 1fr 网格: 5h 段固定第 1 格,7d/30d 段固定第 2 格,
 *   单窗口供应商也按类型落格 → 各行 7d 进度条 y 轴对齐;
 * - 7d/30d 进度条橘色(沿用 quota.css rgb(255,140,60)),5h 维持 --tmd-accent 蓝;
 * - reset 列定宽: 有数据显示 "重置18:30 · 4小时后",无数据留空槽,不推移进度条;
 * - 窗口短标 5h/7d 用 kernel/quota 的 SHORT_WINDOW_LABEL(与 QuotaChip 同源);
 * - 完整时刻(含日期)在 title tooltip,行内只放短格式。
 *
 * 显示规则:
 * - 无任何凭据 → 不渲染(不显示"未登录"噪音,引擎卡本身已有安装状态);
 * - 余额型 → 标题列 + balanceText(套餐名跟在余额后);
 * - 查不到额度 → 标题列 + note 小字。
 */

import { useEffect, useState } from "react";
import { SHORT_WINDOW_LABEL, type QuotaWindow } from "@kernel/quota";
import { formatRelativeTime, formatResetAt } from "@kernel/relativeTime";
import { listEngineCredentials, type EngineCredential } from "./credentials";

/** 周级窗口(7天/30天)落第 2 格并用橘色条;其余(5h/1d)落第 1 格。 */
function isWeeklyWindow(label: string): boolean {
  return label === "7天" || label === "30天";
}

/** 重置时刻短格式: 当天 → "18:30";跨天 → "9月8日"(完整时刻走 tooltip)。 */
function resetShort(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay
    ? `${pad(d.getHours())}:${pad(d.getMinutes())}`
    : `${d.getMonth() + 1}月${d.getDate()}日`;
}

function windowTooltip(w: QuotaWindow): string {
  const base = `${w.label}窗口 · 已使用 ${Math.round(w.displayPercent)}%`;
  return w.resetsAt
    ? `${base} · 重置于 ${formatResetAt(w.resetsAt)}(${formatRelativeTime(w.resetsAt)})`
    : base;
}

function CredWindow({ w }: { w: QuotaWindow }) {
  const weekly = isWeeklyWindow(w.label);
  return (
    <div
      className="welcome-cred-window"
      style={{ gridColumn: weekly ? 2 : 1 }}
      title={windowTooltip(w)}
    >
      <span className="welcome-cred-window-label">
        {SHORT_WINDOW_LABEL[w.label] ?? w.label}
      </span>
      <span className="welcome-cred-window-bar">
        <span
          className={
            weekly
              ? "welcome-cred-window-fill welcome-cred-window-fill--weekly"
              : "welcome-cred-window-fill"
          }
          style={{ width: `${Math.min(100, Math.max(0, w.displayPercent))}%` }}
        />
      </span>
      <span className="welcome-cred-window-pct">
        {Math.round(w.displayPercent)}%
      </span>
      <span className="welcome-cred-window-reset">
        {w.resetsAt
          ? `重置${resetShort(w.resetsAt)} · ${formatRelativeTime(w.resetsAt)}`
          : ""}
      </span>
    </div>
  );
}

export function CredentialList({ engineId }: { engineId: string }) {
  const [creds, setCreds] = useState<EngineCredential[] | null>(null);

  useEffect(() => {
    let alive = true;
    void listEngineCredentials(engineId)
      .then((list) => {
        if (alive) setCreds(list);
      })
      .catch(() => {
        /* 单文件损坏等已由 parseJsonLoose 兜住;此处是最后防线:
           凭据区整体失败也不产生 unhandled rejection */
        if (alive) setCreds([]);
      });
    return () => {
      alive = false;
    };
  }, [engineId]);

  if (!creds || creds.length === 0) return null;

  return (
    <div className="welcome-creds">
      {creds.map((cred) => (
        <div key={cred.providerId} className="welcome-cred">
          <div className="welcome-cred-head">
            <span className="welcome-cred-title">{cred.title}</span>
            {cred.windows.length > 0 && cred.planLabel && (
              <span className="welcome-cred-plan">{cred.planLabel}</span>
            )}
          </div>
          {cred.windows.length > 0 ? (
            <div className="welcome-cred-windows">
              {cred.windows.map((w) => (
                <CredWindow key={w.label} w={w} />
              ))}
            </div>
          ) : cred.balanceText ? (
            <div className="welcome-cred-body">
              <span className="welcome-cred-balance">{cred.balanceText}</span>
              {cred.planLabel && (
                <span className="welcome-cred-plan">{cred.planLabel}</span>
              )}
            </div>
          ) : (
            <div className="welcome-cred-body">
              <span className="welcome-cred-note">{cred.note ?? "已登录"}</span>
              {cred.planLabel && (
                <span className="welcome-cred-plan">{cred.planLabel}</span>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
