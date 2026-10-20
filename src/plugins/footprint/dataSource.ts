/**
 * footprint 视图聚合层:在 query.ts/rollup.ts 数据层之上补齐 UI 视角
 * (journal 会话行、功能卡校验展示、git 提交证据、文件证据归属、
 * 打开文件/所在文件夹通道)。纯读,不维护写路径。
 */
import { ipc, type CkptPatch } from "@kernel/ipc";
import { collectSessionRowsChecked, type DaySessionRow } from "@plugins/workbench/journal/daySessions";
import { dailyPaths } from "@plugins/workbench/journal/journalFiles";
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

/** 日期窗查询两端(Rust parse_iso 契约:naive 串按 UTC 取值,必须传
 *  toISOString() 产物;发本地 naive 串 = 窗口平移时区差,2026-10-20 修)。 */
export function commitWindow(day: string): { since: string; until: string } {
  return {
    since: new Date(`${day}T00:00:00`).toISOString(),
    until: new Date(`${day}T23:59:59`).toISOString(),
  };
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
  /** 功能卡来源(徽标区分 AI 归纳/已修正/纯手动;无卡时无意义)。 */
  cardsOrigin: "ai" | "user-edited" | "manual" | null;
  rows: DaySessionRow[];
  article: string | null;
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

/* 日报路径与写侧 dailyPaths 同源(旧硬编码 workbench/journal/daily 前缀是死路径,
 * article 在真机恒 null;2026-10-20 评审顺手修;digest 不进当日视图,搜索侧另读) */
async function journalArticlePath(day: string): Promise<string> {
  const [y, m, d] = day.split("-").map(Number);
  return (await dailyPaths()).article(y, m, d);
}

async function readTextOrNull(path: string): Promise<string | null> {
  try {
    return await ipc.fsReadFile(path);
  } catch {
    return null;
  }
}

async function loadCommits(day: string): Promise<FpCommit[]> {
  const { since, until } = commitWindow(day);
  const results = await Promise.all(
    getWorkspaces()
      .filter((w) => !findWorkspaceOrigin(w)?.remoteExec)
      .map((w) => ipc.gitCommitsRange(w.root, since, until).catch(() => [] as FpCommit[])),
  );
  return results.flat().sort((a, b) => (a.time < b.time ? -1 : 1));
}

/** 当日视图(点日时机:query 日明细 + 卡校验 + 日报 + lazily git)。 */
export async function loadDayDetail(day: string): Promise<FpDayDetail> {
  const [qd, rowsRes, article, commits] = await Promise.all([
    queryDayDetail(day.slice(0, 7), day.slice(8)),
    loadSessionRows(),
    readTextOrNull(await journalArticlePath(day)),
    loadCommits(day),
  ]);
  const rollup: FpDay = { sessions: qd.sessions, files: {}, batches: qd.batches };
  for (const f of qd.files) rollup.files[f.path] = f;
  const rows = rowsRes.rows.filter((r) => dayKeyOf(new Date(r.startedAt)) === day);
  const known = knownSessionIds(rollup, rows);
  const featureRead = await readFeatureCards(day);
  const cards: FpCardView[] = (featureRead?.file.cards ?? []).map((c) => ({
    ...c,
    unverified: c.sessions.some((sid) => !known.has(sid)),
  }));
  return { day, rollup, cards, cardsOrigin: featureRead?.origin ?? null, rows, article, commits, scanFailed: rowsRes.failed > 0 };
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
      const featureRead = await readFeatureCards(day);
      const cards: FpCardView[] = (featureRead?.file.cards ?? []).map((c) => ({
        ...c,
        unverified: c.sessions.some((sid) => !known.has(sid)),
      }));
      return { day, rollup, cards, cardsOrigin: featureRead?.origin ?? null, rows, article: null, commits: [], scanFailed: rowsRes.failed > 0 };
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

/** 四来源搜索(当月 ± 前后月;kind 主序稳定归并后按日倒序,上限 40)。
 *  归并原因:摊平序按日交错,SearchPop 组头渲染要求同 kind 相邻(评审 P1-11)。 */
const HIT_KIND_ORDER: Record<FpHit["kind"], number> = { card: 0, quote: 1, article: 2, path: 3 };

export async function searchDays(query: string): Promise<FpHit[]> {
  const byDay = await querySearch(query);
  const out: FpHit[] = [];
  for (const day of Object.keys(byDay).sort().reverse()) out.push(...byDay[day]);
  return out
    .map((h, i) => ({ h, i }))
    .sort((a, b) => HIT_KIND_ORDER[a.h.kind] - HIT_KIND_ORDER[b.h.kind] || a.i - b.i)
    .map(({ h }) => h)
    .slice(0, 40);
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
