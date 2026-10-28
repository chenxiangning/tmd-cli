/**
 * AI 判定执行引擎 —— 单次调用协议的 PTY 传输层(指令组装与解析在 unifiedCall.ts,
 * 本文件只管引擎 argv 表、起会话、流式回显、终局取全文与自归档)。
 *
 * 引擎范式与 prompt-enhancer 同款(argv 表 2026-09-21 逐家 --help 实证,随其更新;
 * CLI 私有知识只落本文件):session_spawn 起 PTY → pty://out 流式 → 终局全文返回;
 * 结束自归档磁盘身份,不污染默认会话视图。
 */

import { ipc, onPtyExit, onPtyOutput } from "@kernel/ipc";
import { stripAnsi } from "@kernel/askDetect";
import { archiveSession, sessionArchiveKey } from "@kernel/sessionArchive";
import { host } from "@kernel/host";

/** 引擎 argv 表(prompt-enhancer/enhanceEngines.ts 同源实证;改动须两边同步)。 */
export interface JudgeEngineAdapter {
  id: string;
  command: string;
  buildArgs(prompt: string, model: string | null): string[];
}

function modelArgs(flag: string, model: string | null): string[] {
  const m = model?.trim();
  return m ? [flag, m] : [];
}

export const JUDGE_ENGINES: JudgeEngineAdapter[] = [
  { id: "claude", command: "claude", buildArgs: (p, m) => ["-p", p, ...modelArgs("--model", m)] },
  { id: "codex", command: "codex", buildArgs: (p, m) => ["exec", "--skip-git-repo-check", ...modelArgs("-m", m), p] },
  { id: "omp", command: "omp", buildArgs: (p, m) => ["-p", ...modelArgs("--model", m), p] },
  { id: "pi", command: "pi", buildArgs: (p, m) => ["-p", ...modelArgs("--model", m), p] },
  { id: "opencode", command: "opencode", buildArgs: (p, m) => ["run", ...modelArgs("-m", m), p] },
  { id: "kimi", command: "kimi", buildArgs: (p, m) => ["-p", p, ...modelArgs("-m", m)] },
  { id: "qoder", command: "qoder", buildArgs: (p, m) => ["-p", p, ...modelArgs("-m", m)] },
  { id: "grok", command: "grok", buildArgs: (p, m) => ["--single", p, ...modelArgs("-m", m)] },
];

export interface JudgeRunOpts {
  engineId: string;
  instruction: string;
  model: string | null;
  cwd: string;
  workspaceId: string | null;
  timeoutSeconds: number;
  onChunk?: (liveText: string) => void;
  /** 等待心跳:每 15s 报一次已等待秒数与引擎累计输出字节(引擎可能整段缓冲)。 */
  onWait?: (waitedSec: number, outputBytes: number) => void;
}

/** 剥 ANSI/控制符 + 压空行(与 prompt-enhancer normalizePtyText 同一件)。 */
export function normalizePtyText(text: string): string {
  return stripAnsi(text)
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 起一次 PTY 判定会话并等终局,返回全量清洗文本;超时杀进程后按超时计。
 *  订阅与 prompt-enhancer 同款:exit 后 Rust watcher 自清理句柄,无需退订。 */
export async function runJudgeRaw(opts: JudgeRunOpts): Promise<string> {
  const engine = JUDGE_ENGINES.find((e) => e.id === opts.engineId) ?? JUDGE_ENGINES[0]!;
  const spawned = await ipc.sessionSpawn(
    engine.id,
    { command: engine.command, args: engine.buildArgs(opts.instruction, opts.model), cwd: opts.cwd },
    opts.workspaceId ?? undefined,
  );
  let live = "";
  let timedOut = false;
  let settled = false;
  const startedAt = Date.now();
  const heart = setInterval(() => {
    if (!settled) opts.onWait?.(Math.round((Date.now() - startedAt) / 1000), live.length);
  }, 5000);
  const { promise, resolve } = Promise.withResolvers<string>();
  void onPtyOutput(spawned.id, (chunk) => {
    live += chunk;
    opts.onChunk?.(normalizePtyText(live));
  });
  const timer = setTimeout(() => {
    timedOut = true;
    void ipc.sessionKill(spawned.id).catch(() => {});
  }, Math.max(5, opts.timeoutSeconds) * 1000);
  void onPtyExit(spawned.id, () => {
    if (settled) return;
    settled = true;
    clearInterval(heart);
    clearTimeout(timer);
    resolve(normalizePtyText(live));
  });
  const raw = await promise;
  if (timedOut) throw new Error("judge-timeout");
  /* 仅当输出极短时才把 command not found 当引擎缺失;长回复里含该词是引擎/模型内容,不误判。 */
  if (live.length < 200 && /command not found/i.test(raw)) throw new Error("judge-engine-missing");
  void archiveSpawnedDiskSession(engine.id, opts.cwd, opts.workspaceId).catch(() => {});
  return raw;
}

/** 判定会话自归档(prompt-enhancer 同款):按磁盘身份找 spawn 后新落盘会话归档。 */
async function archiveSpawnedDiskSession(engineId: string, cwd: string, workspaceId: string | null): Promise<void> {
  if (!workspaceId) return;
  const startedAt = Date.now() - 60_000;
  const fresh = await new Promise<string | null>((resolve) => {
    setTimeout(() => {
      const p = host.getCliProfile(engineId);
      p?.listSessions?.(cwd).then(
        (list) => resolve(list.filter((s) => Math.max(s.modifiedAt, s.createdAt ?? 0) >= startedAt).sort((a, b) => b.modifiedAt - a.modifiedAt)[0]?.id ?? null),
        () => resolve(null),
      );
    }, 800);
  });
  if (fresh) await archiveSession(sessionArchiveKey(workspaceId, engineId, fresh));
}

/** 引擎级错误文案(幕布/横幅共用)。 */
export function engineNote(msg: string, engineId: string, timeoutSeconds: number): string {
  if (msg.includes("judge-timeout")) return `判定超时(单批 ${timeoutSeconds}s);可换更快的引擎`;
  if (msg.includes("judge-engine-missing")) return `引擎 ${engineId} 不可用(command not found)`;
  return `判定失败:${msg.slice(0, 120)}`;
}
