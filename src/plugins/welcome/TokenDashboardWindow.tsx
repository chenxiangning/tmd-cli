/**
 * tokens dashboard「窗口重置」小节 —— claude 限额窗口的本地推算展示
 * (quotaWindow.ts 纯函数,零网络,尾读精化见 tokens.ts);30s 重算显示,
 * 不做任何请求。其余引擎本节显「—」:codex/omp/pi 的真额度(含重置时刻)
 * 由凭据额度区呈现,不在此重复两套口径。
 */

import { useEffect, useState } from "react";
import { t } from "@kernel/i18n";
import type { TokenAgg } from "./tokens";

/** 倒计时文案(分钟粒度,钳零)。 */
function countdown(resetAtMs: number, now: number): string {
  const ms = Math.max(0, resetAtMs - now);
  return t("{h}小时{m}分后重置", {
    h: Math.floor(ms / 3600_000),
    m: Math.floor(ms / 60_000) % 60,
  });
}

export function TokenDashboardWindow({
  profileIds,
  windows,
}: {
  profileIds: readonly string[];
  windows: TokenAgg["windows"];
}) {
  /* 30s 重算一次显示:倒计时/进度条全部本地推算,无网络。 */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  /* 汇总:下一个可用窗口 = 最早重置的已推算引擎(resetAt 已过按无数据算)。 */
  let next: { id: string; resetAtMs: number } | null = null;
  for (const [id, win] of Object.entries(windows)) {
    if (!win || win.resetAtMs <= now) continue;
    if (!next || win.resetAtMs < next.resetAtMs) next = { id, resetAtMs: win.resetAtMs };
  }
  const rows = profileIds.map((id) => ({ id, win: windows[id] ?? null }));
  if (rows.length === 0) return null;

  return (
    <div className="tokens-win">
      <div className="tokens-win-head">
        {t("窗口重置")}
        {next && (
          <span className="tokens-win-next">
            {t("下一个可用窗口:{id},{cd}", { id: next.id, cd: countdown(next.resetAtMs, now) })}
          </span>
        )}
      </div>
      {rows.map(({ id, win }) =>
        win && win.resetAtMs > now ? (
          <div key={id} className="trow">
            <span className="en">
              <span className="nm">{id}</span>
            </span>
            <span className="bar wbar">
              <i
                className="strip win"
                style={{
                  "--w": `${Math.min(
                    100,
                    Math.max(0, ((now - win.startMs) / (win.resetAtMs - win.startMs)) * 100),
                  )}%`,
                } as React.CSSProperties}
              />
              <span className="bv">{countdown(win.resetAtMs, now)}</span>
            </span>
          </div>
        ) : (
          <div key={id} className="trow">
            <span className="en">
              <span className="nm">{id}</span>
            </span>
            <span
              className="pct"
              title={id === "claude" ? t("无最近会话数据") : t("口径未知,不猜测兜底")}
            >
              —
            </span>
          </div>
        ),
      )}
    </div>
  );
}
