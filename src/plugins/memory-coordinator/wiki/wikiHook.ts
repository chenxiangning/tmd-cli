/**
 * agent wiki 自动沉淀钩子 —— 会话退出时取用户消息尾段,零模型成本落盘。
 *
 * 任意 profileId 的 CLI 会话退出(非仅 omp):profile.readSessionUserMessages
 * 存在则读尾段,append 一条 auto 条目到该会话 cwd 的 .tmd/wiki.json。
 * 幂等:模块级 Set,一会话生命周期只触发一次(同 autoDistill.prune 模式)。
 * 并发退出经模块级队列串行化(多会话同刻退出时避免读改写竞态);
 * 面板写盘也过同一队列(withWikiLock),两侧不再互相盲写覆盖。
 *
 * 时序铁律(kernel 退出链约定,checkpoints 消费者注释同源):exited 事件发射时
 * 会话与 CLI 身份仍在列表里,同步取齐后才能进异步;排队任务内重查 sessionId
 * 会撞上 hostWatches 已清账本 → 条目静默丢失。
 */

import { host } from "@kernel/host";
import { ipc } from "@kernel/ipc";
import type { CliUserMessage } from "@kernel/cli";
import { exitedReadKey, readUserMessagesOnce } from "../exitedReads";
import { addEntry, excerptFromMsgs, isMissingReadErr, parseWikiDoc, serializeWikiDoc, type WikiDoc } from "./wiki";

/** wiki 单文件在会话 cwd 内的固定落点。 */
export function wikiFilePath(cwd: string): string {
  return `${cwd}/.tmd/wiki.json`;
}

/** 跨窗广播 beat 键:任一窗写盘后 bump,对端 WikiPanel 经 storage 事件重读。 */
export const WIKI_BEAT_KEY = "tmd.wiki.beat.v1";

/** 已沉淀会话(幂等:一次会话生命周期只触发一次)。 */
const distilled = new Set<string>();

/** 幂等集防无界增长:超限剪除已不在活会话列表的 id(同 autoDistill.prune 模式)。 */
function pruneDistilled(): void {
  if (distilled.size < 400) return;
  const alive = new Set(host.getSessions().map((s) => s.id));
  for (const id of distilled) if (!alive.has(id)) distilled.delete(id);
}

/** 写队列:所有落盘读改写(钩子+面板)串行过队,消并发竞态。 */
let queue: Promise<void> = Promise.resolve();

/** 面板/钩子共用的互斥窗:任务内先读后写,队列保证无交叉 RMW。 */
export function withWikiLock<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** 退出时同步取齐的会话身份(exited 发射刻身份仍在账本,过期不候)。 */
interface ExitedCtx {
  cwd: string;
  harness: string;
  cliSessionId: string;
  readMsgs: (cwd: string, cliSessionId: string, full: boolean) => Promise<CliUserMessage[] | null>;
}

async function appendAutoEntry(ctx: ExitedCtx): Promise<boolean> {
  /* 与 phase2/autoDistill 同吃一次磁盘读(exitedReads,批三收敛)。 */
  const msgs = await readUserMessagesOnce(
    exitedReadKey(ctx.harness, ctx.cwd, ctx.cliSessionId),
    () => ctx.readMsgs(ctx.cwd, ctx.cliSessionId, true),
  );
  const excerpt = excerptFromMsgs(msgs ?? []);
  if (!excerpt) return false;
  const path = wikiFilePath(ctx.cwd);
  return withWikiLock(async () => {
    let text: string;
    try {
      text = await ipc.fsReadFile(path);
    } catch (e) {
      if (!isMissingReadErr(String(e))) {
        /* 读失败 ≠ 空库:环境抖动(fd 压力/IO 错误)时落笔会把整个 wiki
         * 清成只剩本条。放弃本条并告警(exited 一会话仅一次触发,无重试口)。 */
        console.warn("[agent-wiki] 读 wiki 失败,放弃本条沉淀", e);
        return false;
      }
      text = "";
    }
    const doc: WikiDoc = text ? parseWikiDoc(text) : { version: 1, entries: [] };
    const next = addEntry(doc, {
      ts: Date.now(),
      harness: ctx.harness,
      /* 幂等键 = CLI 磁盘身份:resume 换 tmd 会话(id 变)不重沉淀同内容条目。 */
      sessionId: ctx.cliSessionId,
      excerpt,
      kind: "auto",
    });
    if (next === doc) return false; /* 幂等命中:同 CLI 会话 auto 已在,不重写。 */
    try {
      await ipc.fsWriteFile(path, serializeWikiDoc(next));
    } catch {
      /* .tmd 目录不存在 → 建目录后重试一次(fsCreateDir 同名已存在报错,一并吞)。 */
      await ipc.fsCreateDir(`${ctx.cwd}/.tmd`).catch(() => undefined);
      await ipc.fsWriteFile(path, serializeWikiDoc(next));
    }
    /* .tmd 进仓库本地排除(.git/info/exclude,幂等):git status 零污染,
     * worktree 移除不因 untracked 被拒。非 git 仓静默失败。 */
    void ipc.gitEnsureLocalExclude(ctx.cwd, ".tmd/").catch(() => undefined);
    return true;
  }).then((written) => {
    if (written) {
      /* 开着的 Wiki 面板即时刷新(host.events 同通道,面板订阅同 topic);
       * 跨窗补一记 localStorage beat:host.events 是进程内总线,另一窗收不到,
       * 对端面板经 storage 事件重读(diffNotes 同先例)。 */
      host.events.emit("memory-coordinator.wiki.updated", { cwd: ctx.cwd });
      try {
        localStorage.setItem(WIKI_BEAT_KEY, JSON.stringify({ cwd: ctx.cwd, ts: Date.now() }));
      } catch {
        /* 存储不可达(隐私模式等)时静默:单窗场景不受影响。 */
      }
    }
    return written;
  });
}

function onSessionExited(sessionId: string): void {
  pruneDistilled();
  if (distilled.has(sessionId)) return;
  const meta = host.getSessions().find((s) => s.id === sessionId);
  if (!meta || !meta.cwd) return;
  const profile = host.getCliProfile(meta.profileId);
  const readMsgs = profile?.readSessionUserMessages;
  if (!readMsgs) return;
  distilled.add(sessionId);
  const ctx: ExitedCtx = {
    cwd: meta.cwd,
    harness: meta.profileId,
    cliSessionId: host.getCliSessionId(sessionId) ?? "",
    readMsgs,
  };
  /* appendAutoEntry 的读改写段内部已过 withWikiLock,此处不再外包(嵌套即死锁)。 */
  appendAutoEntry(ctx).catch((err) => {
    /* 失败归还幂等位:本会话还有重试口(下次同类触发不再被 Set 拦截)。 */
    distilled.delete(sessionId);
    console.warn("[agent-wiki] 沉淀异常", err);
  });
}

/** 插件 activate 期挂载;返回退订函数(payload = 裸 sessionId 字符串)。 */
export function attachWikiStore(): () => void {
  return host.events.on<string>("kernel.sessions.exited", (sessionId) => {
    if (sessionId) onSessionExited(sessionId);
  });
}
