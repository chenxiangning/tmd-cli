/**
 * docgen 生成执行体 —— 队列 → 真实 CLI 会话(journal genSession 姊妹实现)。
 * 差异:产物 = docgen/docs/<entryId>/v<N>.md(入队前定版号,轮询/写入事件都认它);
 * 结算成功只记账(store.settleEntry),失败落 entry.error。无头单发优先
 * (oneshotArgs/oneshotStdin),无声明引擎回落 TUI 写入(journal 同款冷启动窗)。
 */
import { host } from "@kernel/host";
import { t } from "@kernel/i18n";
import { KernelTopics } from "@kernel/events";
import type { SessionMeta } from "@kernel/ipc";
import { getWorkspaces } from "@kernel/workspace";
import { findWorkspaceOrigin } from "@kernel/workspaceOrigins";
import type { PluginEventBus } from "@kernel/plugin";
import { ensureParentDir } from "@kernel/fsDirs";
import { prepareSendPayload } from "@kernel/profileSend";
import { docgenPaths, readText, writeText } from "./paths";
import { ensureWorkbenchLoaded, workbenchSnapshot } from "../store";
import { entryById, failEntry, nextVersion, setEntryGenMeta, settleEntry, terminateEntry } from "./store";
import { assembleDocGenSources, buildDocGenPrompt } from "./prompt";
import { getDocGenTemplate } from "./templates";
import { finishDocGenTask, isDocGenTaskActive, noteDocGenStage, noteDocGenTask, setDocGenRunner, startDocGenTaskRun, type DocGenTask } from "./queue";

/** 生成四阶段(stagebar 轨道;顺序即流水线序)。 */
export const DG_GEN_STAGES: readonly string[] = ["收集事实源", "组装提示词", "模型生成", "落盘结算"];

/** 任务 → 阶段号(queue=-1 未上马;缺 stage 按文案关键词兜底,恢复的 run 已被改判 err 不到这)。 */
export function dgGenStageOf(task: DocGenTask | undefined): number {
  if (!task) return 2;
  if (task.st === "queue") return -1;
  if (task.stage !== undefined) return task.stage;
  const i = DG_GEN_STAGES.findIndex((s) => task.text.includes(s));
  return i >= 0 ? i : 2;
}

/** 结算超时:文档成文链比 journal 短(无摘录落盘往返),取 12 分。 */
const SETTLE_TIMEOUT_MS = 12 * 60_000;
const SETTLE_POLL_MS = 15_000;
/** 写入事件/轮询命中后延迟结算(容忍 agent 随后补充改写;journal 同款)。 */
const SETTLE_GRACE_MS = 8000;

const EXIT_NO_PRODUCT = () => t("会话退出但未产出文档(可重试)");

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

interface PendingSettle {
  taskId: number;
  entryId: string;
  v: number;
  productPath: string;
  sessionId: string;
  engine: string;
  timer: number;
  poll: number;
}

const pending = new Map<string, PendingSettle>();

async function finalize(p: PendingSettle, failText: string | null): Promise<void> {
  if (!pending.delete(p.sessionId)) return;
  clearTimeout(p.timer);
  clearInterval(p.poll);
  /* 收割生成会话:终态后 TUI 空转存活,统一 kill(已退出则静默)。 */
  void host.removeSession(p.sessionId);
  try {
    const md = await readText(p.productPath);
    if (md) {
      const v = await settleEntry(p.entryId, p.engine);
      finishDocGenTask(p.taskId, true, t("已落盘 v{v}", { v }));
      return;
    }
    await failEntry(p.entryId, failText ?? EXIT_NO_PRODUCT());
    finishDocGenTask(p.taskId, false, failText ?? EXIT_NO_PRODUCT());
  } catch (e) {
    /* 结算自身失败(索引写盘/条目已删)不得把任务丢在 run 态等 20 分硬顶。 */
    await failEntry(p.entryId, String(e)).catch(() => undefined);
    finishDocGenTask(p.taskId, false, String(e));
  }
}

function startSettlePoll(p: PendingSettle): void {
  p.poll = window.setInterval(() => {
    void readText(p.productPath)
      .then((md) => {
        if (!md || !pending.has(p.sessionId)) return;
        clearInterval(p.poll);
        p.poll = 0;
        noteDocGenStage(p.taskId, 3, t("落盘结算"));
        window.setTimeout(() => void finalize(p, null), SETTLE_GRACE_MS);
      })
      .catch(() => undefined);
  }, SETTLE_POLL_MS);
}

/** run 态取消的收割体:清守望 + 杀会话 + 条目回落(有版本回 done,无版本移除)。 */
function abortDocRun(task: DocGenTask): void {
  if (!task.sessionId) {
    void terminateEntry(task.entryId);
    return;
  }
  const p = pending.get(task.sessionId);
  if (p) {
    pending.delete(task.sessionId);
    clearTimeout(p.timer);
    clearInterval(p.poll);
  }
  void host.removeSession(task.sessionId);
  void terminateEntry(task.entryId);
}

/** activate 装配:执行体注入 + 内核事件接线;返回退订。 */
export function bootDocGenSession(events: PluginEventBus): () => void {
  setDocGenRunner(runDocGen, abortDocRun);
  const offSettled = events.on<{ sessionId: string }>(KernelTopics.turnSettled, (e) => {
    const p = pending.get(e.sessionId);
    if (!p) return;
    void readText(p.productPath).then((md) => {
      if (md) void finalize(p, null);
      else noteDocGenTask(p.taskId, t("输出静默,等待落盘…"));
    });
  });
  const offExited = events.on<string>(KernelTopics.sessionExited, (sessionId) => {
    const p = pending.get(sessionId);
    if (p) void finalize(p, EXIT_NO_PRODUCT());
  });
  const offEdit = events.on<{ sessionId: string; paths: string[] }>(KernelTopics.fileEditDetected, (e) => {
    const p = pending.get(e.sessionId);
    if (!p || !e.paths?.some((x) => x === p.productPath || x.endsWith(`/v${p.v}.md`))) return;
    noteDocGenStage(p.taskId, 3, t("落盘结算"));
    window.setTimeout(() => void finalize(p, null), SETTLE_GRACE_MS);
  });
  return () => {
    offSettled();
    offExited();
    offEdit();
    setDocGenRunner(null);
  };
}

async function runDocGen(task: DocGenTask): Promise<void> {
  const entry = entryById(task.entryId);
  const template = entry ? getDocGenTemplate(entry.templateId) : undefined;
  const ws = getWorkspaces().find((w) => !findWorkspaceOrigin(w)?.remoteExec);
  const profile = host.getCliProfiles().find((p) => p.id === task.engine);
  if (!entry || !template || template.analysisOnly || !ws || !profile) {
    const reason = !entry ? t("条目不存在") : !template ? t("模板不存在") : template.analysisOnly ? t("纯提示词模板不入队") : !ws ? t("无本地工作区") : t("引擎 {engine} 不可用", { engine: task.engine });
    if (entry) await failEntry(entry.id, reason);
    finishDocGenTask(task.id, false, reason);
    return;
  }
  const paths = await docgenPaths();
  const v = nextVersion(entry.id);
  const productPath = paths.version(entry.id, v);
  noteDocGenStage(task.id, 0, t("收集事实源"));
  await ensureWorkbenchLoaded();
  const sources = await assembleDocGenSources(entry, entry.sources, workbenchSnapshot());
  noteDocGenStage(task.id, 1, t("组装提示词"));
  const prompt = buildDocGenPrompt({ entry, template, productPath, sources, additional: entry.additional });
  const promptPath = paths.prompt(entry.id);
  await ensureParentDir(promptPath);
  await writeText(promptPath, prompt);

  const headless = !!profile.oneshotArgs;
  const meta: SessionMeta = await host.createSession(profile.id, ws.root, ws.id, {
    activate: false,
    ...(headless ? { oneshot: { promptFile: promptPath } } : {}),
  });
  if (!isDocGenTaskActive(task.id)) {
    void host.removeSession(meta.id);
    return;
  }
  /* run 文本进列表 chip 与 journal 任务行:不带会话 id(40 位无断点串会把
   * dg-chip 撑破整列,打开会话走 task.sessionId,id 在此处无消费)。 */
  startDocGenTaskRun(task.id, meta.id, `${t("模型生成")} · ${headless ? t("无头生成") : t("生成会话")}`);
  if (!headless) {
    await sleep(1200);
    const payload = prepareSendPayload({ ...profile, triggers: [] }, prompt);
    const sent = await host.writeSession(meta.id, payload);
    if (!sent) {
      await failEntry(entry.id, t("提示词未能送达(会话可能已退出)"));
      finishDocGenTask(task.id, false, t("提示词未能送达"));
      return;
    }
  } else if (profile.oneshotStdin) {
    const sent = await host.writeSession(meta.id, prompt);
    if (!sent) {
      await failEntry(entry.id, t("提示词未能送达(会话可能已退出)"));
      finishDocGenTask(task.id, false, t("提示词未能送达"));
      return;
    }
  }
  await setEntryGenMeta(entry.id, { sessionId: meta.id });
  if (!isDocGenTaskActive(task.id)) {
    void host.removeSession(meta.id);
    return;
  }
  const p: PendingSettle = {
    taskId: task.id,
    entryId: entry.id,
    v,
    productPath,
    sessionId: meta.id,
    engine: profile.id,
    timer: 0,
    poll: 0,
  };
  p.timer = window.setTimeout(() => {
    void finalize(p, t("生成超时:{min} 分钟无产出", { min: SETTLE_TIMEOUT_MS / 60_000 }));
  }, SETTLE_TIMEOUT_MS);
  pending.set(meta.id, p);
  startSettlePoll(p);
  if (!headless) {
    /* 双保险补提交(TUI 路径;synthetic 机械提交,不碰轮次守望)。 */
    for (const delayMs of [9000, 15000]) {
      window.setTimeout(() => {
        if (pending.has(meta.id)) void host.writeSession(meta.id, "\r", true).catch(() => undefined);
      }, delayMs);
    }
  }
}

