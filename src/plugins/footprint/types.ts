/**
 * footprint 数据层类型与纯判定(设计 spec:docs/superpowers/specs/2026-10-19-footprint-design.md)。
 * 存储布局:~/.tmd-cli/footprint/YYYY-MM.json(按月 rollup)+ features/YYYY-MM-DD.json(功能卡)。
 */

/** 月度 rollup 档。days key = "14"(零填充两位,读写双方约定)。 */
export interface FootprintMonthFile {
  version: 1;
  days: Record<string, FootprintDay>;
}

/** 单日聚合:会话/文件/最近批次(30 天内 diff 抽屉复用 batchId)。 */
export interface FootprintDay {
  sessions: Record<string, FpSessionEntry>;
  /** path → 聚合 ±;refs = 触碰该文件的会话 id。 */
  files: Record<string, { add: number; del: number; cfg: boolean; refs: string[] }>;
  /** sessionId → 最近封口批次 id。 */
  batches: Record<string, string>;
}

export interface FpSessionEntry {
  engine: string;
  cwd: string;
  turns: number[];
  /** ISO 时间串(批.ts / 批.tsEnd)。 */
  first: string;
  last: string;
}

/** 功能卡档(日报生成会话直写;读侧 validateFeatureCards 校验会话引用)。 */
export interface FeatureCardFile {
  version: 1;
  cards: FeatureCard[];
}

export interface FeatureCard {
  title: string;
  summary: string;
  /** 引用的会话 id(必须来自当日 digest 会话枚举)。 */
  sessions: string[];
  quote?: { sid: string; text: string; time: string };
}

/** 文件行视图(当日明细/区间汇总用;path 从 files 键摊平)。 */
export interface FpFileStat {
  path: string;
  add: number;
  del: number;
  cfg: boolean;
  refs: string[];
}

const CFG_EXTS: Record<string, true> = {
  ".yml": true, ".yaml": true, ".json": true, ".toml": true, ".ini": true,
  ".conf": true, ".env": true, ".properties": true, ".xml": true, ".sql": true,
};

/** 配置文件判定(写侧打标;扩展名大小写不敏感)。 */
export function isCfgPath(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return false;
  return CFG_EXTS[path.slice(dot).toLowerCase()] === true;
}

export function emptyDay(): FootprintDay {
  return { sessions: {}, files: {}, batches: {} };
}

export function emptyMonth(): FootprintMonthFile {
  return { version: 1, days: {} };
}

export const pad2 = (n: number): string => String(n).padStart(2, "0");

/** 封口时刻 → 归日键 {ym: "YYYY-MM", dd: "DD"}(本地时区,跨零点归事实时刻)。 */
export function settleKey(ms: number): { ym: string; dd: string } {
  const d = new Date(ms);
  return { ym: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`, dd: pad2(d.getDate()) };
}
