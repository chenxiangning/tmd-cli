/**
 * 会话历史索引器 ── 用户消息抽取 + 内存索引 + 增量扫描编排。
 * 检索纯函数(searchSessions/applyFilters/snippetOf/时间谓词)已拆至
 * ./searchCore(文件规模铁则);本模块只留数据契约 + 作业枚举 + mtime 缓存。
 *
 * 数据面零新增:每个 CLI 的用户消息解析器经 CliProfile.readSessionUserMessages
 * 声明(与对话锚点栏同一数据源);本模块只做编排——按工作区枚举磁盘会话、
 * 增量抽取(单会话一步,调用方驱动节奏)、mtime 缓存跨开关复用。
 * v1 只索引用户消息(「我让它做过什么」是回忆的主键)。边界声明:助手消息
 * 入索引明确不做(041 检索增强批裁决,见 feasibility.md §5);行级定位亦以
 * 命中的用户消息原文为 needle,不扩到助手正文。
 *
 * 跨工作区作用域(042 定稿):构造收 cwds[](本区单元素/全部 = getWorkspaces
 * 各 root);缓存 key = 会话绝对路径(天然全局唯一),值带 cwd 命名空间——
 * prime 只剪「cwd===本次 && 不在 live 集」的键(切区不互踢),另设全局条目
 * LRU 上限(7 区×500 会话≈21MB 字符串,可接受)。
 */

import { host } from "@kernel/host";
import { ipc } from "@kernel/ipc";
import type { CliDiskSession } from "@kernel/cliSessionTypes";
/* cli-shared 联合消费声明:用量行型知识与 welcome/tokens 共持(session-search +
   feature 联合消费,准入见 cli-shared/sessionUsage.ts 头注与 AGENTS.md §1)。 */
import {
  extractUsageFromHead,
  formatUsage,
  summarizeUsage,
} from "../cli-shared/sessionUsage";

/** 索引作用域内的一个工作区(root 必填;id 缺省 = 未在 getWorkspaces 登记)。 */
export interface IndexWorkspace {
  root: string;
  id?: string;
}

/** 单会话索引条目。 */
export interface SessionIndexEntry {
  profileId: string;
  cliSessionId: string;
  /** 磁盘标题(缺省 UI 回退首条消息/短 id)。 */
  title?: string;
  modifiedAt: number;
  /** 所在工作区 root(跨区跳转 cwd 源 + 失效区判定)。 */
  cwd: string;
  /** 所在工作区 id(构造时快照;未登记 = undefined)。 */
  workspaceId?: string;
  /** 用户消息全文(按文件顺序)。 */
  messages: string[];
  /** 用量短文案(`≈ 12.3k tok · $0.04`);无 usage 行型/读取失败 = undefined。 */
  usage?: string;
}

/** 索引快照(进度展示 + 检索输入)。 */
export interface SessionIndex {
  /** 主工作区 root(打开浮层时的当前区;展示锚)。 */
  cwd: string;
  entries: SessionIndexEntry[];
  /** 已处理会话数(含跳过)/ 待处理总数。 */
  scanned: number;
  total: number;
  /** 列举失败的引擎数(listSessions reject):零作业时区分「真没会话」与「读不到」。 */
  listFailed: number;
  /** 本次作业覆盖的工作区总数 / 已枚举完成数(进度「N/M 个工作区」)。 */
  workspacesTotal: number;
  scannedWorkspaces: number;
  /** root 复核失败(目录不可达)的工作区 root:命中行灰显「工作区已移走」不可跳。 */
  goneCwds: string[];
}

/** mtime 缓存值:内容 + 命名空间 cwd + LRU 时钟(lastUse 单调递增)。 */
interface CacheValue {
  cwd: string;
  modifiedAt: number;
  messages: string[];
  usage?: string;
  lastUse: number;
}

/** 全局条目 LRU 上限(042 裁决①:命名空间留存之外的失控护栏;
 *  纯 LRU 会把本区热缓存挤光回到互踢,纯命名空间无上限)。
 *  ponytail: 自估全量语料 ~3500(7 区 × 500),cap 须高于它否则 all-scope
 *  循环扫描永不收敛进缓存排空路径;语料再涨一档时改命名空间公平淘汰。 */
export const INDEX_CACHE_CAP = 5000;

/** mtime 缓存:路径 → 内容。模块级,应用运行期内复用(切浮层/切作用域不丢)。 */
const cache = new Map<string, CacheValue>();
let useSeq = 0;

/** 超量按最近使用淘汰一条(全局,跨工作区)。O(n) 一次,只在越界 set 后触发。 */
function evictIfOverCap(): void {
  if (cache.size <= INDEX_CACHE_CAP) return;
  let oldestKey: string | null = null;
  let oldestUse = Infinity;
  for (const [key, v] of cache) {
    if (v.lastUse < oldestUse) {
      oldestUse = v.lastUse;
      oldestKey = key;
    }
  }
  if (oldestKey !== null) cache.delete(oldestKey);
}

/** 收集一个工作区下所有支持解析的磁盘会话作业(各 profile 并发列举后按时间
 *  归并)。单引擎列举失败不灭全局,但计数上报(零作业时区分真没会话/读不到)。 */
async function collectJobs(
  cwd: string,
): Promise<{ jobs: Array<{ profile: string; session: CliDiskSession }>; failed: number }> {
  const supported = host.getCliProfiles().filter((p) => p.listSessions && p.readSessionUserMessages);
  const lists = await Promise.all(
    supported.map(async (profile) => {
      const sessions = await profile.listSessions!(cwd).catch(() => null);
      return { profile: profile.id, sessions, failed: sessions === null };
    }),
  );
  const jobs = lists.flatMap(({ profile, sessions }) =>
    (sessions ?? []).map((session) => ({ profile, session })),
  );
  jobs.sort((a, b) => b.session.modifiedAt - a.session.modifiedAt);
  return { jobs, failed: lists.filter((l) => l.failed).length };
}

type Job = { profile: string; session: CliDiskSession; cwd: string; workspaceId?: string };

/**
 * 增量索引器:构造收 cwds[](作用域),反复 await step() 推进(每次一个会话,
 * 调用方以宏任务节奏驱动,避免大 I/O 卡帧);done 后 search 即用全量。
 * 未变更会话走 mtime 缓存零读取(他区缓存留存,切区零重读)。
 */
export class SessionIndexer {
  private jobs: Job[] = [];
  readonly index: SessionIndex;
  /** 主 cwd = 作用域首区(打开浮层的当前区)。 */
  readonly cwd: string;

  constructor(private readonly cwds: IndexWorkspace[]) {
    this.cwd = cwds[0]?.root ?? "";
    this.index = {
      cwd: this.cwd,
      entries: [],
      scanned: 0,
      total: 0,
      listFailed: 0,
      workspacesTotal: cwds.length,
      scannedWorkspaces: 0,
      goneCwds: [],
    };
  }

  /** 逐区枚举作业(root 复核:目录不可达 = 失效区,跳过列举进 goneCwds);
   *  返回作业总数。prime 只剪「cwd∈本次 && 不在 live 集」的缓存键(他区留存)。 */
  async prime(): Promise<number> {
    /* root 复核并行探(失效区跳过列举进 goneCwds),collect 也并行、装配保 cwds 顺序。 */
    const reachables = await Promise.all(
      this.cwds.map((ws) => ipc.fsWalkFiles(ws.root, 1).then(() => true, () => false)),
    );
    const results = await Promise.all(
      this.cwds.map((ws, i) =>
        reachables[i]
          ? collectJobs(ws.root).then((r) => ({ ws, jobs: r.jobs, failed: r.failed }))
          : Promise.resolve(null),
      ),
    );
    const all: Job[] = [];
    let failed = 0;
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (!r) {
        this.index.goneCwds.push(this.cwds[i].root);
      } else {
        failed += r.failed;
        for (const j of r.jobs) all.push({ ...j, cwd: r.ws.root, workspaceId: r.ws.id });
      }
      this.index.scannedWorkspaces += 1;
    }
    this.jobs = all;
    /* 死键剪枝只认可达区:瞬时不可达区(网络盘抖动)不列举也不剪,
       否则一次抖动丢整区暖缓存(下轮全量重读);真移走的区由 next prime 收。 */
    const cur = new Set(
      this.cwds.filter((_, i) => reachables[i]).map((w) => w.root),
    );
    const live = new Set(all.map((j) => j.session.path));
    for (const [key, v] of cache) {
      if (cur.has(v.cwd) && !live.has(key)) cache.delete(key);
    }
    this.index.total = all.length;
    this.index.listFailed = failed;
    return all.length;
  }

  /** 推进一个会话;返回 { more: 是否还有剩余, cached: 本步是否缓存命中 }。
   *  cached 供 indexerTicks 时间盒排空:缓存命中步连做,真读步维持 60ms 间隔。 */
  async step(): Promise<{ more: boolean; cached: boolean }> {
    const job = this.jobs.shift();
    if (!job) return { more: false, cached: true };
    const { profile, session, cwd, workspaceId } = job;
    const reader = host.getCliProfile(profile)?.readSessionUserMessages;
    if (!reader) return this.finishStep(true);
    const cached = cache.get(session.path);
    let messages: string[];
    let usage: string | undefined;
    let fromCache = false;
    if (cached && cached.modifiedAt === session.modifiedAt) {
      messages = cached.messages; // 未变更:零读取
      usage = cached.usage;
      cached.lastUse = ++useSeq;
      fromCache = true;
    } else {
      const read = await reader(cwd, session.id, true).catch(() => null);
      messages = read?.map((m) => m.text) ?? [];
      /* 读失败不进缓存:把空消息钉在当前 mtime 上会让该会话正文永久为空
         (mtime 不变则永不重读,评审 MC5);本轮仍按标题入索引,下轮重读 */
      if (read !== null) {
        /* 用量 = 头窗口 256KB(与 welcome TOKENS 同策略:头窗口近似) */
        const head = await ipc.fsReadHead(session.path, 256 * 1024).catch(() => null);
        const summary = head ? summarizeUsage(extractUsageFromHead(head, 0)) : null;
        usage = summary ? formatUsage(summary) : undefined;
        cache.set(session.path, { cwd, modifiedAt: session.modifiedAt, messages, usage, lastUse: ++useSeq });
        evictIfOverCap();
      }
    }
    this.index.entries.push({
      profileId: profile,
      cliSessionId: session.id,
      title: session.title,
      modifiedAt: session.modifiedAt,
      cwd,
      workspaceId,
      messages,
      usage,
    });
    return this.finishStep(fromCache);
  }

  private finishStep(cached: boolean): { more: boolean; cached: boolean } {
    this.index.scanned += 1;
    return { more: this.jobs.length > 0, cached };
  }
}

/** 清空 mtime 缓存(单测隔离用;生产常驻复用)。 */
export function clearIndexCache(): void {
  cache.clear();
}
