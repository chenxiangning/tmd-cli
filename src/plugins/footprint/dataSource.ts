/**
 * footprint 视图聚合层:在 query.ts/rollup.ts 数据层之上补齐 UI 视角
 * (journal 会话行、功能卡校验展示、git 提交证据、文件证据归属、
 * 打开文件/所在文件夹通道)。纯读,不维护写路径。
 */
import { ipc, type CkptPatch } from "@kernel/ipc";
import { collectSessionRowsChecked, type DaySessionRow } from "@plugins/workbench/journal/daySessions";
import { getWorkspaces } from "@kernel/workspace";
import { findWorkspaceOrigin } from "@kernel/workspaceOrigins";
import { resolveDefaultOpenWithFor } from "@kernel/openWith";
import { getSettingsState } from "@kernel/settings";
import { dayDetail as queryDayDetail, monthHeat, range as queryRange, readFeatureCards, searchFootprint as querySearch } from "./query";
import type { DayDetail, HeatCell, RangeSummary, SearchHit, SearchKind } from "./query";
import type { FeatureCard, FootprintDay, FootprintMonthFile } from "./types";

export type { DaySessionRow, DayDetail, HeatCell, RangeSummary, SearchHit, SearchKind };
export type FpDay = FootprintDay;
export type FpMonthFile = FootprintMonthFile;

/** 会话引用校验已标注的功能卡(unverified = 引用了当日枚举外的会话)。 */
export type FpCardView = FeatureCard & { unverified: boolean };

/** rollup files 记录的值类型(无 path;path 在键上)。 */
export type DayFileEntry = FootprintDay["files"][string];

/** git 提交硬证据行(git_repos_log_range 由并行切片落,暂以可选探测接)。 */
export interface FpCommit {
  repo: string;
  hash: string;
  subject: string;
  time: string;
}

/** 日键 YYYY-MM-DD(本地时区)。 */
export function dayKeyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* ── 会话清单(与 journal 月历同源;L2 零改动复用) ── */

/** 全工作区会话行(失败容忍:failed 非空时 UI 示警,不当作全集)。 */
export async function loadSessionRows(): Promise<{ rows: DaySessionRow[]; failed: number }> {
  try {
    const res = await collectSessionRowsChecked();
    return { rows: res.rows, failed: res.failed.length };
  } catch {
    return { rows: [], failed: 0 };
  }
}

/* ── 当日聚合(query 日明细 + 功能卡校验 + journal 行/文章 + git) ── */

/** 点日后的完整当日视图(UI 一次拉齐,不拼多源)。 */
export interface FpDayDetail {
  day: string;
  rollup: FpDay | null;
  cards: FpCardView[];
  rows: DaySessionRow[];
  article: string | null;
  digest: string | null;
  commits: FpCommit[];
  /** 部分引擎清单扫描失败(示警用)。 */
  scanFailed: boolean;
}

/** 当日会话 id 集(rollup sessions ∪ journal 行 id,功能卡引用校验的枚举面)。 */
function knownSessionIds(rollup: FpDay | null, rows: DaySessionRow[]): Set<string> {
  const ids = new Set<string>();
  if (rollup) for (const sid of Object.keys(rollup.sessions)) ids.add(sid);
  for (const r of rows) if (r.id) ids.add(r.id);
  return ids;
}

async function journalPath(kind: "article" | "digest", day: string): Promise<string> {
  return `${await ipc.configDir()}/workbench/journal/daily/${kind}/${day}.md`;
}

async function readTextOrNull(path: string): Promise<string | null> {
  try {
    return await ipc.fsReadFile(path);
  } catch {
    return null;
  }
}

async function loadCommits(day: string): Promise<FpCommit[]> {
  const since = `${day}T00:00:00`;
  const until = `${day}T23:59:59`;
  const results = await Promise.all(
    getWorkspaces()
      .filter((w) => !findWorkspaceOrigin(w)?.remoteExec)
      .map((w) => ipc.gitCommitsRange(w.root, since, until).catch(() => [] as FpCommit[])),
  );
  return results.flat().sort((a, b) => (a.time < b.time ? -1 : 1));
}

/** 当日视图(点日时机:query 日明细 + 卡校验 + article/digest + lazily git)。 */
export async function loadDayDetail(day: string): Promise<FpDayDetail> {
  const [qd, rowsRes, article, digest, commits] = await Promise.all([
    queryDayDetail(day.slice(0, 7), day.slice(8)),
    loadSessionRows(),
    readTextOrNull(await journalPath("article", day)),
    readTextOrNull(await journalPath("digest", day)),
    loadCommits(day),
  ]);
  const rollup: FpDay = { sessions: qd.sessions, files: {}, batches: qd.batches };
  for (const f of qd.files) rollup.files[f.path] = f;
  const rows = rowsRes.rows.filter((r) => dayKeyOf(new Date(r.startedAt)) === day);
  const known = knownSessionIds(rollup, rows);
  const featureFile = await readFeatureCards(day);
  const cards: FpCardView[] = (featureFile?.cards ?? []).map((c) => ({
    ...c,
    unverified: c.sessions.some((sid) => !known.has(sid)),
  }));
  return { day, rollup, cards, rows, article, digest, commits, scanFailed: rowsRes.failed > 0 };
}

/* ── 月历热力 / 区间(转发 query) ── */

/** 区间内逐日视图(会话清单只扫一次,按日过滤)。 */
export async function loadRangeDetails(days: string[]): Promise<FpDayDetail[]> {
  const rowsRes = await loadSessionRows();
  const rowsByDay = new Map<string, DaySessionRow[]>();
  for (const r of rowsRes.rows) {
    const k = dayKeyOf(new Date(r.startedAt));
    const list = rowsByDay.get(k);
    if (list) list.push(r);
    else rowsByDay.set(k, [r]);
  }
  return Promise.all(
    days.map(async (day) => {
      const qd = await queryDayDetail(day.slice(0, 7), day.slice(8));
      const rollup: FpDay = { sessions: qd.sessions, files: {}, batches: qd.batches };
      for (const f of qd.files) rollup.files[f.path] = f;
      const rows = rowsByDay.get(day) ?? [];
      const known = knownSessionIds(rollup, rows);
      const featureFile = await readFeatureCards(day);
      const cards: FpCardView[] = (featureFile?.cards ?? []).map((c) => ({
        ...c,
        unverified: c.sessions.some((sid) => !known.has(sid)),
      }));
      return { day, rollup, cards, rows, article: null, digest: null, commits: [], scanFailed: rowsRes.failed > 0 };
    }),
  );
}

/** 日键 → 当日 ± 汇总(汇总条与未归纳判定共用)。 */
export function dayTotals(rollup: FpDay | null): { sessions: number; plus: number; minus: number } {
  if (!rollup) return { sessions: 0, plus: 0, minus: 0 };
  let plus = 0;
  let minus = 0;
  for (const f of Object.values(rollup.files)) {
    plus += f.add;
    minus += f.del;
  }
  return { sessions: Object.keys(rollup.sessions).length, plus, minus };
}

/** 整月热力格(月历;key = "DD")。 */
export async function loadMonthHeat(ym: string): Promise<HeatCell[]> {
  return monthHeat(ym);
}

/** 区间聚合(含端点,转发 query)。 */
export function loadRange(ymA: string, ddA: string, ymB: string, ddB: string): Promise<RangeSummary> {
  return queryRange(ymA, ddA, ymB, ddB);
}

/* ── 卡片文件证据 / 未归纳日降级 ── */

/** 功能卡的文件证据:refs 与卡会话集相交的当日文件(原型 FILES_BY_FEATURE 语义)。 */
export function cardFiles(rollup: FpDay | null, card: FpCardView): { path: string; stat: DayFileEntry }[] {
  if (!rollup) return [];
  const sids = new Set(card.sessions);
  const out: { path: string; stat: DayFileEntry }[] = [];
  for (const [path, stat] of Object.entries(rollup.files)) {
    if (stat.refs.some((sid) => sids.has(sid))) out.push({ path, stat });
  }
  return out.sort((a, b) => b.stat.refs.length - a.stat.refs.length || a.path.localeCompare(b.path));
}

/** 未归纳日的降级罗列:文件按会话 cwd 顶层目录分组(主管线诚实不装聚类)。 */
export function ungroupedFiles(rollup: FpDay): { project: string; path: string; stat: DayFileEntry }[] {
  const out: { project: string; path: string; stat: DayFileEntry }[] = [];
  for (const [path, stat] of Object.entries(rollup.files)) {
    const cwd = stat.refs.map((sid) => rollup.sessions[sid]?.cwd).find(Boolean) ?? "";
    const project = cwd.split("/").filter(Boolean).pop() ?? "";
    out.push({ project, path, stat });
  }
  return out.sort((a, b) => a.project.localeCompare(b.project) || a.path.localeCompare(b.path));
}

/* ── 抽屉 diff(30 天内复用 checkpointBatchDiff;钥匙 = rollup.batches) ── */

/** 文件行是否可出 diff(有会话 batchId = 账本未清理)。 */
export function fileBatch(rollup: FpDay | null, stat: { refs: string[] }): { cwd: string; batchId: string } | null {
  if (!rollup) return null;
  for (const sid of stat.refs) {
    const batchId = rollup.batches[sid];
    const sess = rollup.sessions[sid];
    if (batchId && sess) return { cwd: sess.cwd, batchId };
  }
  return null;
}

/** 拉某批 diff 并定位到目标文件 patch;命令失败 = null(调用方降级)。 */
export async function loadPatch(cwd: string, batchId: string, path: string): Promise<CkptPatch | null> {
  try {
    const patches = await ipc.checkpointBatchDiff(cwd, batchId);
    return patches.find((p) => p.path === path) ?? null;
  } catch {
    return null;
  }
}

/* ── ⌘K 反查(转发 query 四来源搜索,摊平为命中列表) ── */

export type FpHit = SearchHit;

/** 四来源搜索(当月 ± 前后月;按日倒序,上限 40)。 */
export async function searchDays(query: string): Promise<FpHit[]> {
  const byDay = await querySearch(query);
  const out: FpHit[] = [];
  for (const day of Object.keys(byDay).sort().reverse()) out.push(...byDay[day]);
  return out.slice(0, 40);
}

/* ── 打开文件/所在文件夹(真实通道:既有 open-with / reveal IPC) ── */

/** 系统默认程序打开文件(设置里解析默认打开方式);失败 toast 由调用方兜底。 */
export async function openFileExternally(path: string): Promise<boolean> {
  try {
    const s = getSettingsState().settings;
    const target = resolveDefaultOpenWithFor(s.openWithTargets, s.openWithDefaultId, path);
    if (!target) return false;
    await ipc.fsOpenWith(path, target);
    return true;
  } catch {
    return false;
  }
}

/** 文件管理器中显示所在目录。 */
export async function revealInFileManager(path: string): Promise<boolean> {
  try {
    await ipc.fsRevealInFileManager(path);
    return true;
  } catch {
    return false;
  }
}
