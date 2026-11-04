/**
 * 回顾二级视图契约(批次 C-01)—— journal 主 tab 扩成「回顾」,
 * 二级视图 journal / footprint / sessions(footprint/sessions 由 C-02/C-03 并入本体)。
 *
 * - 视图偏好独立 key(tmd.wb.review.view.v1),不触碰 journal 自持的
 *   视图态(journalTabs VIEW_KEY/YM_KEY 原样);
 * - 深链 payload(view/day)统一经 normalizeReviewPayload 宽容校验,
 *   非法回落 undefined,消费方按默认处理;
 * - 主 tab 仍 5 个,journal id 保留(wbTabs key 不动,只改显示名)。
 */
import { t } from "@kernel/i18n";
import { openTab } from "@kernel/tabs";
import { WB_CONSOLE_TAB_ID, WB_CONSOLE_TAB_KIND } from "../wbTabs";

export type ReviewView = "journal" | "footprint" | "sessions";

export const REVIEW_VIEW_ITEMS: readonly { key: ReviewView; label: string }[] = [
  { key: "journal", label: "工作日志" },
  { key: "footprint", label: "每日足迹" },
  { key: "sessions", label: "会话活动" },
];

const VIEW_KEY = "tmd.wb.review.view.v1";

export function loadReviewView(): ReviewView {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (REVIEW_VIEW_ITEMS.some((v) => v.key === raw)) return raw as ReviewView;
  } catch {
    /* 隐私态/坏档回落默认 */
  }
  return "journal";
}

export function saveReviewView(view: ReviewView): void {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    /* 隐私态:不写即罢 */
  }
}

/** 深链 payload:view 合法即切二级视图;day = "YYYY-MM-DD"(footprint 消费,C-02)。 */
export interface ReviewTabPayload {
  view?: ReviewView;
  day?: string;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 宽容校验深链原始 payload(外部 tab payload 不可信);逐项独立回落。 */
export function normalizeReviewPayload(raw: unknown): ReviewTabPayload {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: ReviewTabPayload = {};
  if (typeof r.view === "string" && REVIEW_VIEW_ITEMS.some((v) => v.key === r.view)) {
    out.view = r.view as ReviewView;
  }
  if (typeof r.day === "string" && DAY_RE.test(r.day)) out.day = r.day;
  return out;
}

/** 打开/激活工作台「回顾」并落到指定二级视图(深链;journal id 与 payload.tab 保留)。 */
export function openWorkbenchReviewTab(opts: ReviewTabPayload = {}): void {
  openTab(
    {
      id: WB_CONSOLE_TAB_ID,
      kind: WB_CONSOLE_TAB_KIND,
      title: t("工作台"),
      path: t("工作台"),
      payload: { tab: "journal", review: normalizeReviewPayload(opts) },
    },
    { refresh: true },
  );
}
