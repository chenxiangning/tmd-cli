/**
 * 生成结算机(从 genSession 拆出,2026-10-13):pending 表 + 三路完工信号 +
 * 唯一成败判据。调度语义见文件头(genSession.ts);判据单测见 settle.test.ts。
 * 结算判据 = 文章全文相对基线真的变化(articleChanged):旧「文件在即成功」
 * 会让并入型任务开跑即假成功 → 生成会话被收割 → summarizedAt 水位被推 →
 * 全天增量并入空转(2026-10-12 事故)。
 */
import { host } from "@kernel/host";
import { t } from "@kernel/i18n";
import { updateTab } from "@kernel/tabs";
import type { Article } from "./articleParse";
import { articleChanged, readText } from "./journalFiles";
import { addBead, reloadDay, setDayResult } from "./journalStore";
import { finishTask, noteTask, type GenTask } from "./taskQueue";
import { ARTICLE_TAB_KIND } from "./journalTabs";
import { hmNow } from "./timeUtil";

/** 结算超时:prompt 送达后无 settle 判失败的兜底。摘录路径成文仍是短链(读一份
 *  摘录 + 写一篇 md),但四点式契约的文章体量与摘录读入都比旧清单路径长,放宽到 15 分;
 *  失败任务尽早离开运行区,不堵串行队列。 */
export const SETTLE_TIMEOUT_MS = 15 * 60_000;

export interface PendingSettle {
  taskId: number;
  dayKey: string;
  y: number;
  m: number;
  d: number;
  sessionId: string;
  timer: number;
  /** 落盘轮询句柄(0 = 未启动);finalize 即清。 */
  poll: number;
  /** 文章绝对路径(runGeneration 解析一次,轮询免重复 dailyPaths)。 */
  articlePath: string;
  type: string;
  /** 会话清单抓取时刻(ms);成功结算时落 DayMeta.summarizedAt。 */
  rowsAt: number;
  /** 起跑时的文章全文(无文章=null):结算唯一成败判据 = 全文相对它真的变化。 */
  baseline: string | null;
}

export const pending = new Map<string, PendingSettle>(); /* sessionId → 结算 */

/** 失败落账统一口(评审 M7):任务终态 + 日错误;定时族补失败珠 —— 幂等闸只认珠,
 *  早退不落珠则 15min tick 持续重入队(最坏 ~96 次 spawn/天)。 */
export function failGen(taskId: number, dayKey: string, type: string, text: string): void {
  finishTask(taskId, false, text);
  setDayResult(dayKey, { lastError: text });
  if (type === "定时生成" || type === "启动补跑" || type === "补齐生成")
    addBead(dayKey, { t: hmNow(), label: `${type} · ${t("失败")}` });
}

/** 终态判定:成败唯一判据 = 文章全文相对基线真的变化(articleChanged)。
 *  并入型(baseline 非 null)模型没写盘 → 判失败,不推 summarizedAt 水位,
 *  下次会话退出/手动增量可重试。 */
export async function finalize(p: PendingSettle, failText: string | null): Promise<void> {
  if (!pending.delete(p.sessionId)) return;
  clearTimeout(p.timer);
  clearInterval(p.poll);
  /* 收割生成会话:终态后 TUI 空转存活直到应用退出(实测 done 后 PTY 日志仍持续
     写 48 分钟),批量补齐会堆积僵尸进程;统一 kill,会话已退出则静默。 */
  void host.removeSession(p.sessionId);
  const next = await readText(p.articlePath).catch(() => null);
  if (!articleChanged(p.baseline, next)) {
    failGen(p.taskId, p.dayKey, p.type, failText ?? (p.baseline === null
      ? t("会话退出但未产出文章(可重试)")
      : t("会话退出但文章未更新,并入未生效(可重试)")));
    return;
  }
  let article: Article | null = null;
  try {
    article = await reloadDay(p.y, p.m, p.d);
  } catch {
    /* 读盘抖动按无产出结算:finishTask 必须执行,任务卡 run 会堵死整条串行队列。 */
  }
  if (article) {
    finishTask(p.taskId, true, t("已落盘 · {title}", { title: article.title.slice(0, 24) }));
    setDayResult(p.dayKey, { lastError: undefined, summarizedAt: p.rowsAt });
    updateTab(`${ARTICLE_TAB_KIND}:${p.dayKey}`, { title: article.title.slice(0, 24) });
    return;
  }
  failGen(p.taskId, p.dayKey, p.type, failText ?? t("文章写入检测到但解析失败(可重试)"));
}

/** turnSettled 到来但文章未变:内核存在假结算窗(长 TTFB/引擎无 busy 标记),
 *  不终态 —— 留 pending 等落盘轮询/退出兜底(editMarks 仅 claude 声明,fileEditDetected
 *  对 omp/pi 系永不来;轮询见 startSettlePoll)。 */
export async function onSettled(p: PendingSettle): Promise<void> {
  const md = await readText(p.articlePath).catch(() => null);
  if (articleChanged(p.baseline, md)) await finalize(p, null);
  else noteTask(p.taskId, t("输出静默,等待落盘…"));
}

/** 落盘轮询兜底:omp/pi 系无 editMarks,fileEditDetected 永不来;turnSettled 假结算后
 *  轮已关不会重发。唯一引擎无关的完工信号 = 文章全文相对基线变化(只查存在会让并入型
 *  开跑即命中旧文假结算)。命中后延迟 8s 结算(容忍 agent 随后的补充改写)。 */
const SETTLE_POLL_MS = 15_000;
export function startSettlePoll(p: PendingSettle): void {
  p.poll = window.setInterval(() => {
    void readText(p.articlePath)
      .then((md) => {
        if (pending.has(p.sessionId) && articleChanged(p.baseline, md)) {
          clearInterval(p.poll);
          p.poll = 0;
          noteTask(p.taskId, t("已检测到文章写入,结算中…"));
          window.setTimeout(() => void finalize(p, null), 8000);
        }
      })
      .catch(() => undefined);
  }, SETTLE_POLL_MS);
}

/** run 态取消的收割体(taskQueue 注入):清结算守望 + 收割会话。
 * sessionId 尚未绑定(spawn 挂起期间取消)时无从收割,由 runGeneration 检查点自弃。 */
export function abortRun(task: GenTask): void {
  if (!task.sessionId) return;
  const p = pending.get(task.sessionId);
  if (p) {
    pending.delete(task.sessionId);
    clearTimeout(p.timer);
    clearInterval(p.poll);
  }
  void host.removeSession(task.sessionId);
}

/** spawn 完成后登记结算守望:超时兜底 + pending 入表。 */
export function trackSettle(p: PendingSettle): void {
  p.timer = window.setTimeout(() => {
    void finalize(p, t("生成超时({n} 分钟无产出)", { n: SETTLE_TIMEOUT_MS / 60_000 }));
  }, SETTLE_TIMEOUT_MS);
  pending.set(p.sessionId, p);
}
