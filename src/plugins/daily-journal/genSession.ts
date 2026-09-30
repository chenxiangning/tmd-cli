/**
 * 生成执行体 —— 任务队列 → 真实 CLI 会话:spawn(config.engine, 首个本地工作区)
 * → prompt(文章 md 契约,见 promptGen)→ 轮次闸写入口 → turnSettled/退出/超时
 * 三口结算(重读当日文章判成败)→ 珠子/错误/任务终态落账。会话即「生成会话」:
 * 用户可随时打开插话干涉(产物以文件为准,干涉后文件更新会被结算重读捕获)。
 * 调度(定时/启动补跑/跟随实时增量)在 journalSchedule.ts。
 */
import { host } from "@kernel/host";
import { KernelTopics } from "@kernel/events";
import { updateTab } from "@kernel/tabs";
import { prepareSendPayload } from "@kernel/profileSend";
import { getWorkspaces } from "@kernel/workspace";
import { findWorkspaceOrigin } from "@kernel/workspaceOrigins";
import type { PluginEventBus } from "@kernel/plugin";
import type { Article } from "./articleParse";
import { dailyPaths, dayKey, readText, writeText } from "./journalFiles";
import { ensureParentDir } from "@kernel/fsDirs";
import { addBead, dayMetaOf, getJournalState, reloadDay, setDayResult } from "./journalStore";
import { collectSessionRows, type DaySessionRow } from "./daySessions";
import { buildDayDigest } from "./sessionDigest";
import { buildGenPrompt, GEN_TASK_MARK, type DigestHandoff } from "./promptGen";
import { finishTask, noteTask, setTaskRunner, startTaskRun, type GenTask } from "./taskQueue";
import { ARTICLE_TAB_KIND } from "./journalTabs";
import { hmNow } from "./timeUtil";

/** 结算超时:prompt 送达后无 settle 判失败的兜底。摘录路径成文仍是短链(读一份
 *  摘录 + 写一篇 md),但四点式契约的文章体量与摘录读入都比旧清单路径长,放宽到 15 分;
 *  失败任务尽早离开运行区,不堵串行队列。 */
const SETTLE_TIMEOUT_MS = 15 * 60_000;

/** 定时等待(spawn 后等 TUI 就绪窗)。 */
function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

interface PendingSettle {
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
  /** 定时族(定时生成/启动补跑/补齐生成):失败要落「尝试过」珠防 15min 重入队。 */
  scheduled: boolean;
  type: string;
  /** 会话清单抓取时刻(ms);成功结算时落 DayMeta.summarizedAt。 */
  rowsAt: number;
}

const pending = new Map<string, PendingSettle>(); /* sessionId → 结算 */

/** 终态判定:文章在 = 成功(回写 tab 标题);不在 = 失败落账(定时族补失败珠防重入队)。 */
async function finalize(p: PendingSettle, failText: string | null): Promise<void> {
  if (!pending.delete(p.sessionId)) return;
  clearTimeout(p.timer);
  clearInterval(p.poll);
  /* 收割生成会话:终态后 TUI 空转存活直到应用退出(实测 done 后 PTY 日志仍持续
     写 48 分钟),批量补齐会堆积僵尸进程;统一 kill,会话已退出则静默。 */
  void host.removeSession(p.sessionId);
  let article: Article | null = null;
  try {
    article = await reloadDay(p.y, p.m, p.d);
  } catch {
    /* 读盘抖动按无产出结算:finishTask 必须执行,任务卡 run 会堵死整条串行队列。 */
  }
  if (article) {
    finishTask(p.taskId, true, `已落盘 · ${article.title.slice(0, 24)}`);
    setDayResult(p.dayKey, { lastError: undefined, summarizedAt: p.rowsAt });
    updateTab(`${ARTICLE_TAB_KIND}:${p.dayKey}`, { title: article.title.slice(0, 24) });
    return;
  }
  finishTask(p.taskId, false, failText ?? "会话已结束但未产出文章(可重试)");
  setDayResult(p.dayKey, { lastError: failText ?? "会话已结束但未产出文章" });
  if (p.scheduled) addBead(p.dayKey, { t: hmNow(), label: `${p.type} · 失败` }); /* 幂等闸覆盖「尝试过」 */
}

/** turnSettled 到来但文章未现:内核存在假结算窗(长 TTFB/引擎无 busy 标记),
 *  不终态 —— 留 pending 等落盘轮询兜底(editMarks 仅 claude 声明,fileEditDetected
 *  对 omp/pi 系永不来;轮询见 startSettlePoll)。 */
async function onSettled(p: PendingSettle): Promise<void> {
  const article = await reloadDay(p.y, p.m, p.d);
  if (article) await finalize(p, null);
  else noteTask(p.taskId, "输出静默,等待落盘…");
}

/** 落盘轮询兜底:omp/pi 系无 editMarks,fileEditDetected 永不来;turnSettled 假结算后
 *  轮已关不会重发。唯一引擎无关的完工信号 = 文章文件本体。命中后延迟 8s 结算
 *  (容忍 agent 随后的补充改写,与 fileEditDetected 路径同款容忍窗)。 */
const SETTLE_POLL_MS = 15_000;
function startSettlePoll(p: PendingSettle): void {
  p.poll = window.setInterval(() => {
    void readText(p.articlePath)
      .then((md) => {
        if (!md || !pending.has(p.sessionId)) return;
        clearInterval(p.poll);
        p.poll = 0;
        noteTask(p.taskId, "已检测到文章写入,结算中…");
        window.setTimeout(() => void finalize(p, null), 8000);
      })
      .catch(() => undefined);
  }, SETTLE_POLL_MS);
}

/** run 态取消的收割体(taskQueue 注入):清结算守望 + 收割会话。
 * sessionId 尚未绑定(spawn 挂起期间取消)时无从收割,由 runGeneration 检查点自弃。 */
function abortRun(task: GenTask): void {
  if (!task.sessionId) return;
  const p = pending.get(task.sessionId);
  if (p) {
    pending.delete(task.sessionId);
    clearTimeout(p.timer);
    clearInterval(p.poll);
  }
  void host.removeSession(task.sessionId);
}

/** activate 时装配:执行体注入 + 内核事件接线。返回退订。 */
export function bootGenSession(events: PluginEventBus): () => void {
  setTaskRunner(runGeneration, abortRun);
  const offSettled = events.on<{ sessionId: string }>(KernelTopics.turnSettled, (e) => {
    const p = pending.get(e.sessionId);
    if (p) void onSettled(p);
  });
  const offExited = events.on<string>(KernelTopics.sessionExited, (sessionId) => {
    const p = pending.get(sessionId);
    if (p) void finalize(p, "生成会话提前退出");
  });
  /* 文件写入事件命中当日文章:延迟 8s 结算(容忍 agent 随后的补充改写)。 */
  const offEdit = events.on<{ sessionId: string; paths: string[] }>(KernelTopics.fileEditDetected, (e) => {
    const p = pending.get(e.sessionId);
    if (!p || !e.paths?.some((x) => x.endsWith(`${p.dayKey}.md`))) return;
    noteTask(p.taskId, "已检测到文章写入,结算中…");
    setTimeout(() => void finalize(p, null), 8000);
  });
  return () => {
    offSettled();
    offExited();
    offEdit();
    setTaskRunner(null); /* 停泵:排队保留;空转 runner 会把队首泵成永不结算的 run */
  };
}

async function runGeneration(task: GenTask): Promise<void> {
  const [y, m, d] = [Number(task.dayKey.slice(0, 4)), Number(task.dayKey.slice(5, 7)), Number(task.dayKey.slice(8, 10))];
  const ws = getWorkspaces().find((w) => !findWorkspaceOrigin(w)?.remoteExec);
  const profile = host.getCliProfiles().find((p) => p.id === task.engine);
  if (!ws || !profile) {
    finishTask(task.id, false, !ws ? "无本地工作区" : `引擎 ${task.engine} 不可用`);
    setDayResult(task.dayKey, { lastError: !ws ? "无本地工作区" : `引擎 ${task.engine} 不可用` });
    return;
  }
  const paths = await dailyPaths();
  const existing = await readText(paths.article(y, m, d));
  const rows = (await collectSessionRows()).filter((r: DaySessionRow) => {
    const ts = new Date(r.startedAt);
    if (dayKey(ts.getFullYear(), ts.getMonth() + 1, ts.getDate()) !== task.dayKey) return false;
    /* 自指防混入:剔除插件自己 spawn 的历次生成会话(标题即 prompt 头;
       摘录层另有首条用户消息同标记的兜底,见 sessionDigest)。 */
    return !r.title.includes(GEN_TASK_MARK) && !(r.disk?.title ?? "").includes(GEN_TASK_MARK);
  });
  rows.sort((a, b) => a.startedAt - b.startedAt);
  /* 归纳水位 = 清单抓取时刻(非落盘时刻):生成期间继续活动的会话保持待归纳。 */
  const rowsAt = Date.now();
  /* 摘录先行:tmd 侧经声明的转录适配器提取当日会话内容落盘,生成会话凭它成文
     (2026-09-30 重构:旧路径只给标题清单,agent 探测 7 家原始格式普遍放弃 → 文章单薄)。
     摘录构建/落盘失败不拦生成:无摘录路径走 prompt 内置的清单降级。 */
  let digest: DigestHandoff | undefined;
  try {
    const built = await buildDayDigest(rows);
    if (built.md) {
      const p = paths.digest(y, m, d);
      await ensureParentDir(p);
      await writeText(p, built.md);
      digest = { path: p, coveredIds: built.coveredIds };
    }
  } catch {
    digest = undefined;
  }
  const prompt = buildGenPrompt(y, m, d, rows, !!existing, paths.article(y, m, d), dayMetaOf(task.dayKey).summarizedAt, digest);
  /* 后台拉起(不抢中央区;用户经任务面板/文章 tab「打开会话」聚焦干涉)。
     模型走 spawn 参数(--model,profile.modelArg 声明制):进程起点即生效,
     不走 TUI /model 输入 —— 启动窗时序会吞行(真机实证两次)。 */
  const meta = await host.createSession(profile.id, ws.root, ws.id, {
    activate: false,
    model: getJournalState().config.model || undefined,
  });
  /* 取消竞态检查点:createSession 是武装结算超时前唯一的无界等待段,挂起期间
     被取消 → 会话落地即弃。先绑 sessionId 再进入等待窗,取消才收割得到会话。 */
  if (!isTaskActive(task.id)) {
    void host.removeSession(meta.id);
    return;
  }
  startTaskRun(task.id, meta.id, `${task.type} · 生成会话 ${meta.id}`);
  /* pi-tui 系冷启动窗:spawn 返回 ≠ TUI 就绪,过早写入会撞 cooked→raw 切换被吃。
     先等一拍再写(真机实证:立即写 → prompt 以 [Paste] 悬在输入框永不提交)。 */
  await sleep(1200);
  const payload = prepareSendPayload({ ...profile, triggers: [] }, prompt);
  const sent = await host.writeSession(meta.id, payload);
  if (!sent) {
    finishTask(task.id, false, "提示词未能送达(会话可能已退出)");
    setDayResult(task.dayKey, { lastError: "提示词未能送达" });
    return;
  }
  setDayResult(task.dayKey, { sessionId: meta.id, engine: profile.id, lastError: undefined });
  addBead(task.dayKey, { t: hmNow(), label: `${task.type} · ${rows.length} 会话${existing ? " · 增量" : ""}` });
  const p: PendingSettle = {
    taskId: task.id,
    dayKey: task.dayKey,
    y,
    m,
    d,
    sessionId: meta.id,
    timer: 0,
    poll: 0,
    articlePath: paths.article(y, m, d),
    scheduled: task.type === "定时生成" || task.type === "启动补跑" || task.type === "补齐生成",
    type: task.type,
    rowsAt,
  };
  p.timer = window.setTimeout(() => {
    void finalize(p, `生成超时(${SETTLE_TIMEOUT_MS / 60_000} 分钟无产出)`);
  }, SETTLE_TIMEOUT_MS);
  pending.set(meta.id, p);
  startSettlePoll(p);
  /* 双保险补提交:若 prompt 仍以 [Paste] 悬在输入框(慢启动吞了结尾 CR),
     裸 CR 把它提交;已正常生成时空输入提交是 no-op,无害。synthetic = 机械
     提交,不得碰轮次/Ask/Edit 三守望状态(锚定已由原 prompt 写入建立)。 */
  for (const delayMs of [9000, 15000]) {
    window.setTimeout(() => {
      if (pending.has(meta.id)) void host.writeSession(meta.id, "\r", true).catch(() => undefined);
    }, delayMs);
  }
}
