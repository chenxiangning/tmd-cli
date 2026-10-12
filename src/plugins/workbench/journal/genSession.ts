/**
 * 生成执行体 —— 任务队列 → 真实 CLI 会话。引擎声明 oneshotArgs 时走无头单发
 * (omp -p:prompt 落盘文件经 @file 传入,进程答完即退,不开 TUI —— 无人值守
 * 会话以 TUI 常驻会产出重绘洪水,经 pty://out 灌 webview 主线程饿死前台幕布,
 * 2026-09-30 卡死根因);未声明的引擎回落 TUI 会话(历史路径原样保留)。
 * 结算:turnSettled/退出/超时三口 → 重读当日文章判成败(退出对无头路径是
 * 正常完工信号,成败只以文章在否为准)→ 珠子/错误/任务终态落账。
 * 调度(定时/启动补跑/跟随实时增量)在 journalSchedule.ts。
 */
import { host } from "@kernel/host";
import { KernelTopics } from "@kernel/events";
import { t } from "@kernel/i18n";
import { updateTab } from "@kernel/tabs";
import { prepareSendPayload } from "@kernel/profileSend";
import type { SessionMeta } from "@kernel/ipc";
import { getWorkspaces } from "@kernel/workspace";
import { findWorkspaceOrigin } from "@kernel/workspaceOrigins";
import type { PluginEventBus } from "@kernel/plugin";
import type { Article } from "./articleParse";
import { dailyPaths, readText, writeText } from "./journalFiles";
import { ensureParentDir } from "@kernel/fsDirs";
import { addBead, dayMetaOf, getJournalState, reloadDay, setDayResult } from "./journalStore";
import { collectSessionRowsBatched, isRowSummarized, rowDayKey, type DaySessionRow } from "./daySessions";
import { buildDayDigest } from "./sessionDigest";
import { buildGenPrompt, GEN_TASK_MARK, type DigestHandoff } from "./promptGen";
import { DOC_GEN_MARK } from "../docgen/types";
import { finishTask, isTaskActive, noteTask, setTaskRunner, startTaskRun, type GenTask } from "./taskQueue";
import { ARTICLE_TAB_KIND } from "./journalTabs";
import { hmNow } from "./timeUtil";
import { ensureWorkbenchLoaded, workbenchSnapshot } from "../store";
import { dayProjectLinks } from "./dayLinks";
import type { ProjectPromptGroup } from "./promptGen";
import type { ProjectDigestGroup } from "./sessionDigest";
/** 结算超时:prompt 送达后无 settle 判失败的兜底。摘录路径成文仍是短链(读一份
 *  摘录 + 写一篇 md),但四点式契约的文章体量与摘录读入都比旧清单路径长,放宽到 15 分;
 *  失败任务尽早离开运行区,不堵串行队列。 */
const SETTLE_TIMEOUT_MS = 15 * 60_000;

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
  type: string;
  /** 会话清单抓取时刻(ms);成功结算时落 DayMeta.summarizedAt。 */
  rowsAt: number;
}

const pending = new Map<string, PendingSettle>(); /* sessionId → 结算 */

/** 失败落账统一口(评审 M7):任务终态 + 日错误;定时族补失败珠 —— 幂等闸只认珠,
 *  早退不落珠则 15min tick 持续重入队(最坏 ~96 次 spawn/天)。 */
function failGen(taskId: number, dayKey: string, type: string, text: string): void {
  finishTask(taskId, false, text);
  setDayResult(dayKey, { lastError: text });
  if (type === "定时生成" || type === "启动补跑" || type === "补齐生成")
    addBead(dayKey, { t: hmNow(), label: `${type} · ${t("失败")}` });
}

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
  failGen(p.taskId, p.dayKey, p.type, failText ?? t("会话退出但未产出文章(可重试)"));
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
  /* 兜预结算段抛错(createSession/prompt 落盘等拒绝):不接住会绕过 failGen——任务只 patch
   * err 不落珠,定时族每 15min 重入队且当日无错可显。 */
  setTaskRunner((task) => runGeneration(task).catch((e: unknown) => {
    if (!isTaskActive(task.id)) return; /* 显式早退已 failGen,取消竞态不重复落账 */
    failGen(task.id, task.dayKey, task.type, `${t("生成会话异常")}:${e instanceof Error ? e.message : String(e)}`);
  }), abortRun);
  const offSettled = events.on<{ sessionId: string }>(KernelTopics.turnSettled, (e) => {
    const p = pending.get(e.sessionId);
    if (p) void onSettled(p);
  });
  const offExited = events.on<string>(KernelTopics.sessionExited, (sessionId) => {
    const p = pending.get(sessionId);
    if (p) void finalize(p, t("会话退出但未产出文章(可重试)"));
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
    failGen(task.id, task.dayKey, task.type, !ws ? t("无本地工作区") : t("引擎 {engine} 不可用", { engine: task.engine }));
    return;
  }
  const paths = await dailyPaths();
  const existing = await readText(paths.article(y, m, d));
  /* 清单部分失败即中止:残缺清单落 summarizedAt 水位会把缺席会话永久错标「已归纳」(L19)。 */
  let scanFailed = 0;
  const collected = await collectSessionRowsBatched(undefined, (scan) => { scanFailed = scan.failed.length; });
  if (scanFailed) {
    failGen(task.id, task.dayKey, task.type, t("会话扫描部分失败,已中止本次生成(可重试)"));
    return; /* 真中止:残缺清单不得继续走生成/结算,缺席会话会被永久错标已归纳(L19) */
  }
  const rows = collected.filter((r: DaySessionRow) => {
    if (rowDayKey(r) !== task.dayKey) return false;
    /* 自指防混入:剔除插件自己 spawn 的历次生成会话(标题即 prompt 头;
       摘录层另有首条用户消息同标记的兜底,见 sessionDigest)。
       [DOC-GEN] = docgen 流水线会话(同插件姊妹域),同属自指。 */
    const title = `${r.title} ${r.disk?.title ?? ""}`;
    return !title.includes(GEN_TASK_MARK) && !title.includes(DOC_GEN_MARK);
  });
  const summarizedAt = dayMetaOf(task.dayKey).summarizedAt;
  rows.sort((a, b) => a.startedAt - b.startedAt);
  /* 归纳水位 = 清单抓取时刻(非落盘时刻):生成期间继续活动的会话保持待归纳。 */
  const rowsAt = Date.now();
  /* 项目分组(工作台派生,2026-10-11 并入):行 wsId→工作区根↔Project.cwd 精确
   * 匹配(dayLinks 单一真相源);工作台数据不可用/为空 = 零分组,生成照旧。 */
  let projectGroups: ProjectPromptGroup[] = [];
  let digestGroups: ProjectDigestGroup[] = [];
  try {
    await ensureWorkbenchLoaded();
    const links = dayProjectLinks(
      rows,
      workbenchSnapshot(),
      getWorkspaces().filter((w) => !findWorkspaceOrigin(w)?.remoteExec),
    );
    projectGroups = links.map((l) => ({ name: l.projectName, titles: l.rows.map((r) => r.title) }));
    digestGroups = links.map((l) => ({ name: l.projectName, ids: new Set(l.rows.map((r) => r.id ?? "")) }));
  } catch {
    /* 降级:无分组生成 */
  }
  /* 摘录先行:tmd 侧经声明的转录适配器提取当日会话内容落盘,生成会话凭它成文(2026-09-30 重构:
     旧路径只给标题清单,agent 探测 7 家原始格式普遍放弃 → 文章单薄)。增量语义:已归纳行(内容已在
     文章里)不重读转录,只摘新增;摘录构建/落盘失败不拦生成:无摘录路径走 prompt 内置的清单降级。 */
  const digestRows = summarizedAt !== undefined ? rows.filter((r) => !isRowSummarized(r, summarizedAt)) : rows;
  let digest: DigestHandoff | undefined;
  try {
    const built = await buildDayDigest(digestRows, digestGroups);
    if (built.md) {
      const p = paths.digest(y, m, d);
      await ensureParentDir(p);
      await writeText(p, built.md);
      digest = { path: p, coveredIds: built.coveredIds };
    }
  } catch {
    digest = undefined;
  }
  const prompt = buildGenPrompt(y, m, d, rows, !!existing, paths.article(y, m, d), summarizedAt, digest, projectGroups);
  /* 后台拉起(不抢中央区;用户经任务面板/文章 tab「打开会话」聚焦干涉)。
     模型走 spawn 参数(--model,profile.modelArg 声明制):进程起点即生效,
     不走 TUI /model 输入 —— 启动窗时序会吞行(真机实证两次)。
     引擎声明 oneshotArgs 走无头单发:prompt 落盘文件经 @file 传入(argv 装不下
     数百 KB 的摘录+清单),进程答完即退;--no-session 不落会话文件,当日索引
     零污染(自指过滤退化为历史数据的保险丝)。 */
  const headless = !!profile.oneshotArgs;
  let promptPath: string | undefined;
  if (headless) {
    promptPath = paths.prompt(y, m, d);
    await ensureParentDir(promptPath);
    await writeText(promptPath, prompt);
  }
  const meta: SessionMeta = await host.createSession(profile.id, ws.root, ws.id, {
    activate: false,
    model: getJournalState().config.model || undefined,
    ...(headless ? { oneshot: { promptFile: promptPath! } } : {}),
  });
  /* 取消竞态检查点:createSession 是唯一无界等待段,先绑 sessionId 再进等待窗,取消才收割得到会话。 */
  if (!isTaskActive(task.id)) {
    void host.removeSession(meta.id);
    return;
  }
  /* run 文本进任务行 chip:不带会话 id(无断点长串撑破行布局;打开会话走 task.sessionId)。 */
  startTaskRun(task.id, meta.id, `${task.type} · ${headless ? "无头生成" : "生成会话"}`);
  if (!headless) {
    /* TUI 路径(引擎无 oneshotArgs 声明):pi-tui 系冷启动窗 spawn 返回 ≠ TUI 就绪,
       过早写入会撞 cooked→raw 切换被吃。先等一拍再写(真机实证:立即写 → prompt
       以 [Paste] 悬在输入框永不提交)。 */
    await new Promise<void>((r) => setTimeout(r, 1200));
    const payload = prepareSendPayload({ ...profile, triggers: [] }, prompt);
    const sent = await host.writeSession(meta.id, payload);
    if (!sent) {
      failGen(task.id, task.dayKey, task.type, t("提示词未能送达(会话可能已退出)"));
      return;
    }
  } else if (profile.oneshotStdin) {
    /* stdin 递送引擎(codex exec - / claude -p 管道形态):spawn 后经 PTY 注入全文。
       无头进程无 cooked→raw 切换、启动即持续读 stdin,无冷启动窗可撞;大 prompt
       超 PTY 缓冲由读端流速自然排空,写端阻塞有 15 分硬顶兜底。 */
    const sent = await host.writeSession(meta.id, prompt);
    if (!sent) {
      failGen(task.id, task.dayKey, task.type, t("提示词未能送达(会话可能已退出)"));
      return;
    }
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
    type: task.type,
    rowsAt,
  };
  p.timer = window.setTimeout(() => {
    void finalize(p, t("生成超时({n} 分钟无产出)", { n: SETTLE_TIMEOUT_MS / 60_000 }));
  }, SETTLE_TIMEOUT_MS);
  pending.set(meta.id, p);
  startSettlePoll(p);
  if (!headless) {
    /* 双保险补提交(TUI 路径独有):若 prompt 仍以 [Paste] 悬在输入框(慢启动吞了
       结尾 CR),裸 CR 把它提交;已正常生成时空输入提交是 no-op,无害。synthetic =
       机械提交,不得碰轮次/Ask/Edit 三守望状态(锚定已由原 prompt 写入建立)。 */
    for (const delayMs of [9000, 15000]) {
      window.setTimeout(() => {
        if (pending.has(meta.id)) void host.writeSession(meta.id, "\r", true).catch(() => undefined);
      }, delayMs);
    }
  }
}
