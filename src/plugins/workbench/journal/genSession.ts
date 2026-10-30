/**
 * 生成执行体 —— 任务队列 → 真实 CLI 会话。引擎声明 oneshotArgs 时走无头单发
 * (omp -p:prompt 落盘文件经 @file 传入,进程答完即退,不开 TUI —— 无人值守
 * 会话以 TUI 常驻会产出重绘洪水,经 pty://out 灌 webview 主线程饿死前台幕布,
 * 2026-09-30 卡死根因);未声明的引擎回落 TUI 会话(历史路径原样保留)。
 * 结算机(pending/三路完工信号/成败判据)在 genSettle.ts;成败唯一判据 =
 * 文章全文相对起跑基线真的变化(articleChanged),不作假成功。
 * 调度(定时/启动补跑/跟随实时增量)在 journalSchedule.ts。
 */
import { host } from "@kernel/host";
import { errTextDisplay } from "@kernel/errText";
import { KernelTopics } from "@kernel/events";
import { t } from "@kernel/i18n";
import { prepareSendPayload } from "@kernel/profileSend";
import type { SessionMeta } from "@kernel/ipc";
import { getWorkspaces } from "@kernel/workspace";
import { findWorkspaceOrigin } from "@kernel/workspaceOrigins";
import type { PluginEventBus } from "@kernel/plugin";
import { abortRun, failGen, finalize, onSettled, pending, startSettlePoll, trackSettle } from "./genSettle";
import { dailyPaths, readText, writeText } from "./journalFiles";
import { ensureParentDir } from "@kernel/fsDirs";
import { addBead, dayMetaOf, getJournalState, setDayResult } from "./journalStore";
import { collectSessionRowsBatched, isRowSummarized, rowDayKey, type DaySessionRow } from "./daySessions";
import { buildDayDigest } from "./sessionDigest";
import { buildGenPrompt, GEN_TASK_MARK, type DigestHandoff } from "./promptGen";
import { DOC_GEN_MARK } from "../docgen/types";
import { finishTask, isTaskActive, noteTask, setTaskRunner, startTaskRun, type GenTask } from "./taskQueue";
import { hmNow } from "./timeUtil";
import type { PendingSettle } from "./genSettle";
import { ensureWorkbenchLoaded, workbenchSnapshot } from "../store";
import { dayProjectLinks } from "./dayLinks";
import type { ProjectPromptGroup } from "./promptGen";
import type { ProjectDigestGroup } from "./sessionDigest";
/** 结算超时:prompt 送达后无 settle 判失败的兜底。摘录路径成文仍是短链(读一份
 *  摘录 + 写一篇 md),但四点式契约的文章体量与摘录读入都比旧清单路径长,放宽到 15 分;
 *  失败任务尽早离开运行区,不堵串行队列。 */
/** activate 时装配:执行体注入 + 内核事件接线。返回退订。 */
export function bootGenSession(events: PluginEventBus): () => void {
  /* 兜预结算段抛错(createSession/prompt 落盘等拒绝):不接住会绕过 failGen——任务只 patch
   * err 不落珠,定时族每 15min 重入队且当日无错可显。 */
  setTaskRunner((task) => runGeneration(task).catch((e: unknown) => {
    if (!isTaskActive(task.id)) return; /* 显式早退已 failGen,取消竞态不重复落账 */
    failGen(task.id, task.dayKey, task.type, `${t("生成会话异常")}:${errTextDisplay(e)}`);
  }), abortRun);
  const offSettled = events.on<{ sessionId: string }>(KernelTopics.turnSettled, (e) => {
    const p = pending.get(e.sessionId);
    if (p) void onSettled(p);
  });
  const offExited = events.on<string>(KernelTopics.sessionExited, (sessionId) => {
    const p = pending.get(sessionId);
    if (p) void finalize(p, null); /* 成败由 finalize 按基线变化裁决 */
  });
  /* 文件写入事件命中当日文章:延迟 8s 结算(容忍 agent 随后的补充改写)。 */
  const offEdit = events.on<{ sessionId: string; paths: string[] }>(KernelTopics.fileEditDetected, (e) => {
    const p = pending.get(e.sessionId);
    if (!p || !e.paths?.some((x) => x.endsWith(`${p.dayKey}.md`))) return;
    noteTask(p.taskId, t("已检测到文章写入,结算中…"));
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
  /* 无文章之日水位失义(文章不存在 = 没有任何内容「已在文章里」):整日按未归纳摘录。
     防残文删除重建后仍被旧水位压成清单降级薄文(2026-10-12 事故闭环)。 */
  const effectiveSummarized = existing ? summarizedAt : undefined;
  /* 增量待归纳行:并入型(已有文章)若零新增,任务直落「无需并入」——
     不 spawn 不占串行队列,更不会把生成会话空跑一轮(2026-10-12 实证空转)。 */
  const digestRows = effectiveSummarized !== undefined ? rows.filter((r) => !isRowSummarized(r, effectiveSummarized)) : rows;
  if (existing && digestRows.length === 0) {
    finishTask(task.id, true, t("无新增会话,文章已是最新"));
    return;
  }
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
  const prompt = buildGenPrompt(y, m, d, rows, !!existing, paths.article(y, m, d), effectiveSummarized, digest, projectGroups, paths.featureCards(y, m, d));
  /* 后台拉起(不抢中央区;用户经任务面板/文章 tab「打开会话」聚焦干涉)。
     模型走 spawn 参数(--model,profile.modelArg 声明制):进程起点即生效,
     不走 TUI /model 输入 —— 启动窗时序会吞行(真机实证两次)。
     引擎声明 oneshotArgs 走无头单发:prompt 落盘文件经 @file 传入(argv 装不下
     数百 KB 的摘录+清单),进程答完即退;--no-session 不落会话文件,当日索引
     零污染(自指过滤退化为历史数据的保险丝)。 */
  /* 无头覆盖(2026-10-26 本机实证盘点):omp/pi/claude/opencode(run+stdin)/
   * qoder 双版(-p+stdin)已声明;kimi/grok 的 -p/--single 必填串参数(数百 KB
   * prompt 爆 argv,无 stdin 通道)、dsh 为 profile 启动器(无 print 模式),
   * 三家回落 TUI 是实证后的正确形态,勿凭印象补声明。 */
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
  startTaskRun(task.id, meta.id, `${task.type} · ${t(headless ? "无头生成" : "生成会话")}`);
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
  addBead(task.dayKey, { t: hmNow(), label: existing ? t("{type} · {n} 会话 · 增量", { type: task.type, n: rows.length }) : t("{type} · {n} 会话", { type: task.type, n: rows.length }) });
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
    baseline: existing || null, /* 零字节文视同无文,判据与文案分支同口径 */
  };
  trackSettle(p);
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
