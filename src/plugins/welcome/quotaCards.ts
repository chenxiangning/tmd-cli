/**
 * 首页 QUOTA 面板模型 —— 卡片化套餐水位
 * (设计 docs/design/040-candidates/3-quota-reset.html)。
 *
 * 数据源两路,互不猜测:
 * - 真额度:凭据盘点(credentials.ts,供应商额度 HTTP/本地文件),带已用 %
 *   与重置时刻(5 小时 + 7 天双窗口并列展示);
 * - claude 本地推算:claude 无额度 API,5h 滚动窗口起点/重置只能由会话
 *   JSONL 用量行尾读推算(cli-shared/quota/quotaWindow 纯函数)。
 * 查不到的卡(查询失败 / 仅余额 / 无窗口)一律不渲染 —— 面板只报真水位,
 * 全查不到时空态一行说明。环形「已用 %」、倒计时、汇总条由同一份
 * 窗口数据渲染,不会漂移。
 */

import { ipc } from "@kernel/ipc";
import type { CliDiskSession, CliProfile } from "@kernel/cli";
import type { QuotaWindow } from "@kernel/quota";
import type { EngineCredential } from "./credentials";
import {
  extractUsageFromHead,
  type UsageLine,
} from "../cli-shared/sessionUsage";
import { windowResetFor } from "../cli-shared/quota/quotaWindow";

/** 配额告警线(与行内块条/凭据区同语义)。 */
export const QUOTA_HOT_PCT = 90;
/** 热度渐变起点:低于此线纯充裕绿,50–90 绿→琥珀,90–100 琥珀→红。 */
const QUOTA_WARM_PCT = 50;

/** 已用 % → 环形热度渐变色:0–50 纯绿,50–90 绿→琥珀渐变,≥90 琥珀→红渐变。
 *  用 color-mix 混主题语义色,深浅主题自适应;边界连续(50=纯绿,90=纯琥珀,100=纯红)。 */
export function quotaHeatColor(pct: number): string {
  const p = Math.min(100, Math.max(0, pct));
  if (p < QUOTA_HOT_PCT) {
    const t = Math.max(0, ((p - QUOTA_WARM_PCT) / (QUOTA_HOT_PCT - QUOTA_WARM_PCT)) * 100);
    return `color-mix(in oklch, var(--tmd-warn) ${t.toFixed(1)}%, var(--tmd-ok))`;
  }
  const t = ((p - QUOTA_HOT_PCT) / (100 - QUOTA_HOT_PCT)) * 100;
  return `color-mix(in oklch, var(--tmd-err) ${t.toFixed(1)}%, var(--tmd-warn))`;
}

/** claude 窗口推算的尾窗字节数(usage 行追加在文件尾,与 tokens 时代同值)。 */
const TAIL_BYTES = 128 * 1024;
/** 只扫近 7 日活跃会话:窗口已滚走的旧会话对推算无意义。 */
const SCAN_MS = 7 * 86400_000;

/** 卡内窗口块。inferred = claude 本地推算(环形无读数,只有倒计时)。 */
export interface CardWindow {
  key: string;
  label: string;
  /** 环形已用 %(0-100);null = 推算窗口(无额度口径)。 */
  pct: number | null;
  /** 已限额强调(pct ≥ 告警线)。 */
  hot: boolean;
  resetsAt: number | null;
  /** 推算窗口:窗口起点(渲染「窗口起点 HH:MM」)。 */
  startMs?: number;
  inferred?: boolean;
}

/** 面板卡。一卡 N 窗口(5 小时 + 7 天并列);余额型供应商无窗口,卡体展示余额。 */
export interface QuotaCard {
  key: string;
  name: string;
  /** 套餐名 pill(planLabel)。 */
  plan?: string;
  /** 窗口块,展示序:5 小时在前、7 天次之,其余按重置时刻。 */
  windows: CardWindow[];
  /** 余额型卡体文本(如 "¥-1.29");仅 windows 为空的余额卡有值。 */
  balanceText?: string;
}

/* ── 聚合(纯函数)──────────────────────────────────── */

/** 按供应商 title 去重聚合(同 title 多副本择优:有窗口 > 有余额 > 仅 note)。 */
export interface QuotaAgg {
  title: string;
  windows: QuotaWindow[];
  balanceText?: string;
  planLabel?: string;
  note?: string;
}

/** 供应商凭据列表 → 去重聚合(旧页脚 aggregateQuotas 原样迁入)。 */
export function aggregateQuotas(
  credsMap: Record<string, EngineCredential[]>,
): QuotaAgg[] {
  const byTitle = new Map<string, QuotaAgg>();
  const informative = (c: QuotaAgg): boolean =>
    c.windows.length > 0 || !!c.balanceText || !!c.note;
  const score = (c: QuotaAgg): number =>
    (c.windows.length > 0 ? 4 : 0) + (c.balanceText ? 2 : 0) + (c.note ? 0 : 1);
  for (const creds of Object.values(credsMap)) {
    for (const c of creds) {
      if (!informative(c)) continue;
      const prev = byTitle.get(c.title);
      const next: QuotaAgg = {
        title: c.title,
        windows: c.windows,
        balanceText: c.balanceText,
        planLabel: c.planLabel,
        note: c.note,
      };
      if (!prev || score(next) > score(prev)) byTitle.set(c.title, next);
    }
  }
  return [...byTitle.values()];
}

/** 展示序:5 小时最前、7 天次之(与 codexLocal.windowOrder 同口径)。 */
function windowRank(label: string): number {
  if (label === "5小时") return 0;
  if (label === "7天") return 1;
  return 2;
}

function dataCard(agg: QuotaAgg): QuotaCard | null {
  /* 余额型(deepseek/中转站:无窗口有余额)也成卡,沉底展示余额数值。 */
  if (agg.windows.length === 0) {
    if (!agg.balanceText) return null;
    return {
      key: `quota:${agg.title}`,
      name: agg.title,
      plan: agg.planLabel,
      windows: [],
      balanceText: agg.balanceText,
    };
  }
  const windows: CardWindow[] = agg.windows
    .map((w) => ({
      key: w.label,
      label: w.label,
      pct: w.displayPercent,
      hot: w.displayPercent >= QUOTA_HOT_PCT,
      resetsAt: w.resetsAt ?? null,
    }))
    .sort((a, b) => windowRank(a.label) - windowRank(b.label));
  return { key: `quota:${agg.title}`, name: agg.title, plan: agg.planLabel, windows };
}

/** 卡内最早的重置时刻(排序与汇总条共用;无时刻 = 排最后)。 */
function cardResetAt(c: QuotaCard): number {
  let min = Infinity;
  for (const w of c.windows) if (w.resetsAt != null && w.resetsAt < min) min = w.resetsAt;
  return min;
}

/**
 * 面板卡列表 = 真额度卡 + 余额卡(沉底)+ claude 推算卡,按卡内最早重置时刻升序
 * (汇总条同序取首个未过期窗口)。查不到的卡一律不出现。
 */
export function buildQuotaCards(args: {
  quotas: QuotaAgg[];
  /** claude 窗口尾读推算结果(null = 无近 7 日会话行)。 */
  claudeWin: { startMs: number; resetAtMs: number } | null;
  /** 凭据盘点已有 claude 真额度时,推算卡不重复。 */
  claudeHasQuota: boolean;
}): QuotaCard[] {
  const { quotas, claudeWin, claudeHasQuota } = args;
  const cards: QuotaCard[] = [];
  for (const agg of quotas) {
    const card = dataCard(agg);
    if (card) cards.push(card);
  }
  if (claudeWin && !claudeHasQuota) {
    cards.push({
      key: "quota:claude:infer",
      name: "claude",
      windows: [
        {
          key: "5小时",
          label: "5小时",
          pct: null,
          hot: false,
          resetsAt: claudeWin.resetAtMs,
          startMs: claudeWin.startMs,
          inferred: true,
        },
      ],
    });
  }
  cards.sort((a, b) => cardResetAt(a) - cardResetAt(b));
  return cards;
}

/** 汇总条目标:全部窗口里重置最近且未过期的那一格。 */
export function nextQuotaWindow(
  cards: readonly QuotaCard[],
  now: number,
): { card: QuotaCard; win: CardWindow } | null {
  let best: { card: QuotaCard; win: CardWindow } | null = null;
  for (const card of cards) {
    for (const win of card.windows) {
      if (win.resetsAt == null || win.resetsAt <= now) continue;
      if (!best || win.resetsAt < (best.win.resetsAt ?? Infinity)) best = { card, win };
    }
  }
  return best;
}

/** 倒计时拆分(分钟粒度向上取整);<= 0 返回 null(已重置终态)。 */
export function splitCountdown(ms: number): { h: number; m: number } | null {
  const total = Math.ceil(ms / 60_000);
  if (total <= 0) return null;
  return { h: Math.floor(total / 60), m: total % 60 };
}

/* ── claude 窗口尾读推算(IO)────────────────────────── */

/**
 * claude 当前 5h 限额窗口推算:全工作区 × 近 7 日活跃会话,尾读 128KB
 * 提取用量行(行追加在文件尾,头窗只有过期行),交 windowResetFor 纯函数。
 * 单会话读失败跳过;无任何行/窗口已滚走 → null。
 */
export async function inferClaudeWindow(
  profiles: readonly CliProfile[],
  workspaces: readonly { root: string }[],
  now: number,
): Promise<{ startMs: number; resetAtMs: number } | null> {
  const claude = profiles.find((p) => p.id === "claude" && p.listSessions);
  if (!claude) return null;
  const startMs = now - SCAN_MS;
  const paths: string[] = [];
  await Promise.all(
    workspaces.map(async (ws) => {
      const sessions: CliDiskSession[] = await claude
        .listSessions!(ws.root)
        .catch(() => [] as CliDiskSession[]);
      for (const s of sessions) {
        if (s.modifiedAt >= startMs) paths.push(s.path);
      }
    }),
  );
  const lines: UsageLine[] = [];
  /* 4 并发闸:无批量尾读命令,防 fd 风暴(与 tokens 时代同理由)。 */
  for (let i = 0; i < paths.length; i += 4) {
    await Promise.all(
      paths.slice(i, i + 4).map(async (p) => {
        try {
          const tail = await ipc.fsReadTail(p, TAIL_BYTES);
          if (tail) lines.push(...extractUsageFromHead(tail, startMs));
        } catch {
          /* 单会话失败跳过 */
        }
      }),
    );
  }
  if (lines.length === 0) return null;
  const w = windowResetFor("claude", lines, now);
  return w ? { startMs: w.windowStartMs, resetAtMs: w.resetAtMs } : null;
}
