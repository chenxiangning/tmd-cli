/**
 * 会话历史索引器 ── 用户消息抽取 + 内存索引 + 子串检索。
 *
 * 数据面零新增:每个 CLI 的用户消息解析器经 CliProfile.readSessionUserMessages
 * 声明(与对话锚点栏同一数据源);本模块只做编排——按工作区枚举磁盘会话、
 * 增量抽取(单会话一步,调用方驱动节奏)、mtime 缓存跨开关复用、子串检索。
 * v1 只索引用户消息(「我让它做过什么」是回忆的主键);助手正文随二期评估。
 */

import { host } from "@kernel/host";
import { ipc } from "@kernel/ipc";
import type { CliDiskSession } from "@kernel/cliSessionTypes";
import {
  extractUsageFromHead,
  formatUsage,
  summarizeUsage,
} from "../cli-shared/sessionUsage";

/** 单会话索引条目。 */
export interface SessionIndexEntry {
  profileId: string;
  cliSessionId: string;
  /** 磁盘标题(缺省 UI 回退首条消息/短 id)。 */
  title?: string;
  modifiedAt: number;
  /** 用户消息全文(按文件顺序)。 */
  messages: string[];
  /** 用量短文案(`≈ 12.3k tok · $0.04`);无 usage 行型/读取失败 = undefined。 */
  usage?: string;
}

/** 索引快照(进度展示 + 检索输入)。 */
export interface SessionIndex {
  cwd: string;
  entries: SessionIndexEntry[];
  /** 已处理会话数(含跳过)/ 待处理总数。 */
  scanned: number;
  total: number;
}

/** mtime 缓存:路径 → (mtime, 消息, 用量文案)。模块级,应用运行期内复用。 */
const cache = new Map<string, { modifiedAt: number; messages: string[]; usage?: string }>();

/** 收集当前工作区下所有支持解析的磁盘会话作业(各 profile 并发列举后按时间归并)。 */
async function collectJobs(cwd: string): Promise<Array<{ profile: string; session: CliDiskSession }>> {
  const supported = host.getCliProfiles().filter((p) => p.listSessions && p.readSessionUserMessages);
  const lists = await Promise.all(
    supported.map(async (profile) => ({
      profile: profile.id,
      sessions: await profile.listSessions!(cwd).catch(() => [] as CliDiskSession[]),
    })),
  );
  const jobs = lists.flatMap(({ profile, sessions }) =>
    sessions.map((session) => ({ profile, session })),
  );
  jobs.sort((a, b) => b.session.modifiedAt - a.session.modifiedAt);
  return jobs;
}

/**
 * 增量索引器:构造时枚举作业,反复 await step() 推进(每次一个会话,
 * 调用方以宏任务节奏驱动,避免大 I/O 卡帧);done 后 search 即用全量。
 * 未变更会话走 mtime 缓存零读取。
 */
export class SessionIndexer {
  private jobs: Array<{ profile: string; session: CliDiskSession }> = [];
  readonly index: SessionIndex;

  constructor(readonly cwd: string) {
    this.index = { cwd, entries: [], scanned: 0, total: 0 };
  }

  /** 枚举作业(listSessions 并发全量);返回作业总数。 */
  async prime(): Promise<number> {
    this.jobs = await collectJobs(this.cwd);
    this.index.total = this.jobs.length;
    return this.jobs.length;
  }

  /** 推进一个会话;返回是否还有剩余。 */
  async step(): Promise<boolean> {
    const job = this.jobs.shift();
    if (!job) return false;
    const { profile, session } = job;
    const reader = host.getCliProfile(profile)?.readSessionUserMessages;
    if (!reader) return this.next();
    const cached = cache.get(session.path);
    let messages: string[];
    let usage: string | undefined;
    if (cached && cached.modifiedAt === session.modifiedAt) {
      messages = cached.messages; // 未变更:零读取
      usage = cached.usage;
    } else {
      const read = await reader(this.cwd, session.id, true).catch(() => null);
      messages = read?.map((m) => m.text) ?? [];
      /* 用量 = 头窗口 256KB(与 welcome TOKENS 同策略:头窗口近似) */
      const head = await ipc.fsReadHead(session.path, 256 * 1024).catch(() => null);
      const summary = head ? summarizeUsage(extractUsageFromHead(head, 0)) : null;
      usage = summary ? formatUsage(summary) : undefined;
      cache.set(session.path, { modifiedAt: session.modifiedAt, messages, usage });
    }
    this.index.entries.push({
      profileId: profile,
      cliSessionId: session.id,
      title: session.title,
      modifiedAt: session.modifiedAt,
      messages,
      usage,
    });
    return this.next();
  }

  private next(): boolean {
    this.index.scanned += 1;
    return this.jobs.length > 0;
  }
}

/** 命中结果:条目 + 首个命中消息的片段(含前后文窗口)。 */
export interface SessionSearchHit {
  entry: SessionIndexEntry;
  snippet: string;
  /** 命中发生在标题(优先展示)。 */
  inTitle: boolean;
}

/** 匹配片段:命中点前后各取 ~60 字符,边界补省略号。 */
function snippet(text: string, needle: string): string {
  const at = text.toLowerCase().indexOf(needle);
  const start = Math.max(0, at - 60);
  const end = Math.min(text.length, at + needle.length + 60);
  const body = text.slice(start, end);
  return `${start > 0 ? "…" : ""}${body}${end < text.length ? "…" : ""}`;
}

/**
 * 子串检索(大小写不敏感):标题命中优先,其余按最近修改排序,截前 limit 条。
 * O(条目 × 消息) 内存扫描,千级会话语义下毫秒级,不值得 FTS5。
 */
export function searchSessions(
  index: SessionIndex,
  query: string,
  limit = 50,
): SessionSearchHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const hits: SessionSearchHit[] = [];
  for (const entry of index.entries) {
    const inTitle = entry.title?.toLowerCase().includes(needle) ?? false;
    const message = entry.messages.find((m) => m.toLowerCase().includes(needle));
    if (!inTitle && !message) continue;
    hits.push({
      entry,
      snippet: message ? snippet(message, needle) : (entry.title ?? ""),
      inTitle,
    });
    if (hits.length >= limit) break;
  }
  hits.sort((a, b) => {
    if (a.inTitle !== b.inTitle) return a.inTitle ? -1 : 1;
    return b.entry.modifiedAt - a.entry.modifiedAt;
  });
  return hits;
}

/** 清空 mtime 缓存(单测隔离用;生产常驻复用)。 */
export function clearIndexCache(): void {
  cache.clear();
}
