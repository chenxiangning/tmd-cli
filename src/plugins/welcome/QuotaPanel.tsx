/**
 * 首页 QUOTA 面板 —— 套餐水位卡片网格
 * (设计 docs/design/040-candidates/3-quota-reset.html:面板条/汇总条/引擎卡)。
 * 卡数据两路:凭据盘点真额度(credsMap,5 小时 + 7 天双窗口并列)+ claude
 * 会话 JSONL 尾读本地推算(quotaCards.ts)。查不到的卡不渲染;倒计时 30s
 * 本地重算,无网络轮询。「刷新重算」= 页级 refreshTick++(凭据 effect 与
 * 本面板推算 effect 同键重跑)。
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ChartBar, Clock } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { host } from "@kernel/host";
import { Empty } from "@kernel/Empty";
import { SHORT_WINDOW_LABEL } from "@kernel/quota";
import { useWorkspaces } from "@kernel/workspace";
import type { EngineCredential } from "./credentials";
import {
  aggregateQuotas,
  buildQuotaCards,
  inferClaudeWindow,
  nextQuotaWindow,
  quotaHeatColor,
  splitCountdown,
  type CardWindow,
  type QuotaCard,
} from "./quotaCards";

const two = (n: number) => String(n).padStart(2, "0");
/** HH:MM:SS(最近推算时间戳用)。 */
const hms = (ms: number) => {
  const d = new Date(ms);
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
};
/** 重置时刻短格式:当天 → "18:30";跨天 → "9月8日"。 */
function resetClock(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay
    ? `${two(d.getHours())}:${two(d.getMinutes())}`
    : t("{m}月{d}日", { m: d.getMonth() + 1, d: d.getDate() });
}

/** 倒计时文案(分钟粒度);已过期/无时刻返回 null。 */
function countdownText(win: CardWindow, now: number): string | null {
  if (win.resetsAt == null) return null;
  const cd = splitCountdown(win.resetsAt - now);
  if (!cd) return null;
  return cd.h > 0 ? t("{h}小时 {m}分后", cd) : t("{m}分后", cd);
}

/** 窗口块倒计时主/副文案(纯函数,集中分支)。ok=已重置绿态。 */
function windowCdParts(
  win: CardWindow,
  now: number,
): { main: string; hot: boolean; ok: boolean; sub: string } {
  if (win.resetsAt == null) return { main: "—", hot: false, ok: false, sub: "" };
  if (win.resetsAt <= now) {
    return {
      main: t("已重置"),
      hot: false,
      ok: true,
      sub: t("新窗口已开始计数,用量从 0 起算"),
    };
  }
  const cd = countdownText(win, now);
  if (!cd) return { main: "—", hot: false, ok: false, sub: "" };
  const startClock =
    win.inferred && win.startMs != null
      ? `${two(new Date(win.startMs).getHours())}:${two(new Date(win.startMs).getMinutes())}`
      : null;
  const sub = startClock
    ? t("窗口起点 {time} · 由本窗口首条用量行推算", { time: startClock })
    : t("重置于 {time}", { time: resetClock(win.resetsAt) });
  return { main: cd, hot: win.hot, ok: false, sub };
}

/* 环形进度;r=32,周长 C≈201.06;颜色按已用热度渐变(绿→琥珀→红,见 quotaHeatColor)。 */
function Ring({ pct, color, size }: { pct: number; color: string; size: number }) {
  const C = 2 * Math.PI * 32;
  const dash = ((C * Math.min(100, Math.max(0, pct))) / 100).toFixed(2);
  return (
    <svg width={size} height={size} viewBox="0 0 76 76" aria-hidden="true">
      <circle cx="38" cy="38" r="32" fill="none" stroke="var(--tmd-bg-hover)" strokeWidth="6" />
      <circle
        cx="38" cy="38" r="32" fill="none" stroke={color} strokeWidth="6"
        strokeLinecap="round" strokeDasharray={`${dash} ${C.toFixed(2)}`}
      />
    </svg>
  );
}

/** 窗口块环形(aria + 中心读数;拆出降 WindowBlock 控制流复杂度)。 */
function WindowRing({
  win, expired, size,
}: {
  win: CardWindow;
  expired: boolean;
  size: number;
}) {
  const shown = win.pct == null ? null : expired ? 0 : win.pct;
  const aria =
    shown == null
      ? {}
      : {
          role: "progressbar" as const,
          "aria-valuemin": 0,
          "aria-valuemax": 100,
          "aria-valuenow": shown,
          "aria-label": t("{name} 当前窗口已用 {pct}%", { name: win.label, pct: shown }),
        };
  return (
    <div className="wq-ring" {...aria}>
      <Ring pct={shown ?? 0} color={quotaHeatColor(shown ?? 0)} size={size} />
      <div className={`wq-ring-pct${shown == null ? " muted" : ""}`}>
        {shown == null ? "—" : `${shown}%`}
        <small>{shown == null ? t("不猜测") : t("已用")}</small>
      </div>
    </div>
  );
}

function WindowBlock({
  win, multi, now,
}: {
  win: CardWindow;
  /** 多窗口卡:环形缩小一档,双窗并列。 */
  multi: boolean;
  now: number;
}) {
  const expired = win.resetsAt != null && win.resetsAt <= now;
  const cd = windowCdParts(win, now);
  return (
    <div className="wq-win">
      <WindowRing win={win} expired={expired} size={multi ? 60 : 76} />
      <div className="wq-cd">
        <div className="wq-cd-label">
          {SHORT_WINDOW_LABEL[win.label] ?? t(win.label)}
          {win.inferred ? ` · ${t("可推算")}` : ""}
        </div>
        <div className={`wq-cd-val${cd.hot && !expired ? " wq-hot-text" : cd.ok ? " wq-ok-text" : ""}`}>
          {cd.main}
        </div>
        <div className="wq-cd-sub">{cd.sub}</div>
      </div>
    </div>
  );
}

function CardView({ card, now }: { card: QuotaCard; now: number }) {
  const primary = card.windows[0];
  const primaryExpired = primary != null && primary.resetsAt != null && primary.resetsAt <= now;
  const statusPill =
    primary == null || primary.pct == null ? null : primaryExpired ? (
      <span className="wq-pill wq-ok">{t("充裕")}</span>
    ) : primary.hot ? (
      <span className="wq-pill wq-limited">{t("已限额")}</span>
    ) : (
      <span className="wq-pill wq-ok">{t("充裕")}</span>
    );
  return (
    <div className={`wq-card${card.windows.length > 1 ? " wq-multi" : ""}`}>
      <div className="wq-card-top">
        <span className="wq-name">{t(card.name)}</span>
        {card.plan && <span className="wq-pill wq-plan">{t(card.plan)}</span>}
        {statusPill}
      </div>
      {card.windows.length > 0 ? (
        <div className="wq-wins">
          {card.windows.map((w) => (
            <WindowBlock key={w.key} win={w} multi={card.windows.length > 1} now={now} />
          ))}
        </div>
      ) : (
        card.balanceText != null && <div className="wq-balance">{card.balanceText}</div>
      )}
    </div>
  );
}

export function QuotaPanel({
  credsMap,
  refreshTick,
  onRefresh,
}: {
  credsMap: Record<string, EngineCredential[]>;
  /** 手动全量刷新计数:变化时凭据 effect 与本面板推算 effect 同键重跑。 */
  refreshTick: number;
  onRefresh: () => void;
}) {
  /* 订阅快照 = profile 集指纹:仅插件拔插时重渲染。 */
  const profilesKey = useSyncExternalStore(
    host.subscribe,
    () => host.getCliProfiles().map((p) => p.id).join("|"),
  );
  const profiles = useMemo(() => host.getCliProfiles(), [profilesKey]);
  const { list: workspaces } = useWorkspaces();
  const [claudeWin, setClaudeWin] = useState<{
    startMs: number;
    resetAtMs: number;
  } | null>(null);
  const [lastCalc, setLastCalc] = useState<number | null>(null);
  const [recalcing, setRecalcing] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  /* 倒计时 30s 本地重算:显示层滴答,无网络。 */
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  /* claude 窗口尾读推算:挂载/手动刷新时跑一次(读盘异步,失败 = 无推算卡)。 */
  useEffect(() => {
    let alive = true;
    void inferClaudeWindow(profiles, workspaces, Date.now()).then((w) => {
      if (!alive) return;
      setClaudeWin(w);
      setLastCalc(Date.now());
      setRecalcing(false);
    });
    return () => {
      alive = false;
    };
  }, [profiles, workspaces, refreshTick]);

  const cards = useMemo(() => {
    const quotas = aggregateQuotas(credsMap);
    /* note-only 聚合(官方订阅无窗口回包)不算已有真额度,否则压制推算卡 */
    const claudeHasQuota = quotas.some((q) => q.windows.length > 0 && /claude/i.test(q.title));
    return buildQuotaCards({ quotas, claudeWin, claudeHasQuota });
  }, [credsMap, claudeWin]);

  const next = nextQuotaWindow(cards, now);
  const nextCd = next ? countdownText(next.win, now) : null;

  return (
    <div className="welcome-quota">
      <div className="wq-bar">
        <div className="wq-title">
          <ChartBar size={16} aria-hidden />
          quota — {t("套餐水位")}
          <span className="wq-sub">{t("数据源:供应商额度查询 + 会话记录本地推算")}</span>
          {lastCalc != null && (
            <span className="wq-sub">{t("最近推算 {time}", { time: hms(lastCalc) })}</span>
          )}
        </div>
        <button
          type="button"
          className="wq-btn"
          onClick={() => {
            setRecalcing(true);
            onRefresh();
          }}
          disabled={recalcing}
        >
          {recalcing ? t("推算中…") : t("刷新重算")}
        </button>
      </div>
      <div className="wq-summary">
        <Clock size={16} aria-hidden />
        <span className="wq-sum-main">
          {next && nextCd
            ? next.win.inferred
              ? t("下一个可用窗口:{name}（推算）,{cd}", { name: next.card.name, cd: nextCd })
              : t("下一个可用窗口:{name},{cd}", { name: next.card.name, cd: nextCd })
            : t("全部可推算窗口均已重置")}
        </span>
        <span className="wq-sum-note">{t("倒计时本地每分钟重算,无网络轮询")}</span>
      </div>
      <div className="wq-grid">
        {cards.length === 0 && (
          <Empty icon={<ChartBar aria-hidden />}>{t("暂无可查询的套餐额度")}</Empty>
        )}
        {cards.map((c) => (
          <CardView key={c.key} card={c} now={now} />
        ))}
      </div>
    </div>
  );
}
