/**
 * 会话语料采集 —— 经各 cli-* 插件声明的内省适配器(host.getCliProfiles()),
 * 本插件零 CLI 私有格式知识(架构铁则:读各家 session JSONL 只能经适配器)。
 *
 * 口径移植 tmd-lint sessions.rs:30 天窗口、净化(系统注入过滤:任务书/
 * instructions 注入不是用户的话,留着会把任务内容误当纠正话术)、项目体检
 * cwd 全等过滤(经 readSessionFileIdentity 自证,无身份=丢弃,不猜)。
 * 工具调用取转录 tool 块 detail(命令串/文件路径,壳外知识由各适配器已归一)。
 */

import type { CliDiskSession, CliProfile, CliTranscriptBlock } from "@kernel/cli";
import type { CorpusCall, CorpusMsg, SessionCorpus } from "./lintTypes";

const MAX_TEXT = 4000;
const MAX_SESSIONS_PER_PROFILE = 120;
const MAX_MSGS = 30000;

/* 系统注入前缀(tmd-lint 实证表:omp 任务书注入以「Complete assignment…」开头) */
const USER_BLOCK_PREFIXES = ["<", "Caveat:", "# AGENTS.md", "Complete assignment thoroughly"];
const USER_BLOCK_CONTAINS = ["<INSTRUCTIONS>", "<user_instructions>"];

/** user 侧净化:空/超长/系统注入丢弃;返回 null = 丢弃。 */
export function sanitizeUserText(s: string): string | null {
  const t = s.trim();
  if (!t || t.length > MAX_TEXT) return null;
  if (USER_BLOCK_PREFIXES.some((p) => t.startsWith(p))) return null;
  if (USER_BLOCK_CONTAINS.some((c) => t.includes(c))) return null;
  return t;
}

/** assistant 侧净化:空/超长丢弃。 */
export function sanitizeBodyText(s: string): string | null {
  const t = s.trim();
  if (!t || t.length > MAX_TEXT) return null;
  return t;
}

function callDetailOf(b: CliTranscriptBlock): string | null {
  const d = b.tool?.detail?.trim() ?? "";
  if (d.length < 2 || d.length > MAX_TEXT) return null;
  return d;
}

/** 一个会话的转录块 → 语料条目(sessionIdx 由调用方分配;时间窗先扣)。 */
export function blocksToCorpus(
  blocks: CliTranscriptBlock[],
  sessionIdx: number,
  cutoffMs: number,
): { msgs: CorpusMsg[]; calls: CorpusCall[] } {
  const msgs: CorpusMsg[] = [];
  const calls: CorpusCall[] = [];
  for (const b of blocks) {
    const ts = b.startedAt ?? 0;
    if (ts !== 0 && ts < cutoffMs) continue;
    if (b.role === "user" || b.role === "assistant") {
      const text = b.role === "user" ? sanitizeUserText(b.text) : sanitizeBodyText(b.text);
      if (!text) continue;
      msgs.push({ sessionIdx, role: b.role, text, lower: text.toLowerCase(), ts });
    } else if (b.role === "tool") {
      const detail = callDetailOf(b);
      if (detail) calls.push({ sessionIdx, detail, ts });
    }
  }
  return { msgs, calls };
}

function sameDir(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/\/+$/, "");
  return norm(a) === norm(b);
}

/** profile 内省面切片(测试可喂纯对象)。 */
export type CorpusProfileSource = Pick<
  CliProfile,
  "id" | "listSessions" | "readSessionFileIdentity" | "readSessionTranscript"
>;

export interface CollectOpts {
  profiles: CorpusProfileSource[];
  /** 项目体检 = 工作区 cwd(全等过滤);null = 全局体检不过滤。 */
  cwd: string | null;
  cutoffMs: number;
  /** 采集时间预算(ms;到点即止,语料可能不完整——独立版全量读在千会话仓会假死)。 */
  budgetMs?: number;
  /** 逐会话进度(done/total/profileId),UI 进度条数据源。 */
  onSession?: (done: number, total: number, profileId: string) => void;
  onProfileDone?: (profileId: string, stat: { sessions: number; msgs: number; calls: number }) => void;
}

/**
 * 全量采集:逐 profile 扫会话 → 身份 cwd 过滤 → 转录 → 块入语料。
 * 刻意顺序遍历(sessionIdx 按序分配保确定性;数百转录并发读会打成 IPC 洪峰,
 * react-doctor async-await-in-loop 对本文件豁免,同 sessionHead.ts 先例)。
 * 单 profile/单会话失败跳过不坏全局(坏一船不坏一队);消息总量封顶防失控。
 */
export async function collectCorpus(opts: CollectOpts): Promise<SessionCorpus> {
  const msgs: CorpusMsg[] = [];
  const calls: CorpusCall[] = [];
  const perProfile: SessionCorpus["perProfile"] = [];
  let sessionCount = 0;
  let readFiles = 0;
  const deadline = opts.budgetMs ? Date.now() + opts.budgetMs : Number.POSITIVE_INFINITY;
  for (const p of opts.profiles) {
    if (!p.listSessions || !p.readSessionTranscript) continue;
    let sessions: CliDiskSession[] = [];
    try {
      sessions = await p.listSessions(opts.cwd ?? "");
    } catch {
      continue;
    }
    sessions = sessions
      .filter((s) => s.modifiedAt >= opts.cutoffMs - 48 * 3600 * 1000)
      .sort((a, b) => b.modifiedAt - a.modifiedAt)
      .slice(0, MAX_SESSIONS_PER_PROFILE);
    let pMsgs = 0;
    let pCalls = 0;
    let pSessions = 0;
    let done = 0;
    for (const s of sessions) {
      done += 1;
      if (Date.now() > deadline) break;
      if (msgs.length >= MAX_MSGS) break; /* 消息总量到顶,早停防失控 */
      opts.onSession?.(done, sessions.length, p.id);
      if (opts.cwd) {
        let identityCwd: string | null = null;
        try {
          identityCwd = (await p.readSessionFileIdentity?.(s.path))?.cwd ?? null;
        } catch {
          identityCwd = null;
        }
        if (!identityCwd || !sameDir(identityCwd, opts.cwd)) continue;
      }
      let blocks: CliTranscriptBlock[] = [];
      try {
        blocks = (await p.readSessionTranscript(s))?.blocks ?? [];
      } catch {
        continue;
      }
      readFiles += 1;
      const part = blocksToCorpus(blocks, sessionCount, opts.cutoffMs);
      if (part.msgs.length === 0 && part.calls.length === 0) continue;
      pSessions += 1;
      pMsgs += part.msgs.length;
      pCalls += part.calls.length;
      if (msgs.length < MAX_MSGS) msgs.push(...part.msgs.slice(0, MAX_MSGS - msgs.length));
      calls.push(...part.calls);
      sessionCount += 1;
    }
    perProfile.push({ profileId: p.id, sessions: pSessions, msgs: pMsgs, calls: pCalls });
    opts.onProfileDone?.(p.id, { sessions: pSessions, msgs: pMsgs, calls: pCalls });
  }
  return { msgs, calls, sessionCount, readFiles, perProfile };
}
