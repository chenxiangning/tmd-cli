/**
 * 规则体检共享类型 —— 判定态/证据/结果的跨模块契约。
 *
 * 移植自独立工具 tmd-lint(对话日志体检规则文件);核心差异:七态判定不再走
 * 「纠正 ≥2 次/触达 ≥1 次」阈值 if 链,改由 AI 大模型基于证据包实时语义判断
 * (aiJudge.ts)。机器把关(pre-commit 含规则命令)是硬事实,仍确定性先判,
 * 不烧模型调用。
 */

/** 体检目标 = 各 cli-* profile 的 memoryFiles 声明按唯一文件去重。 */
export interface LintTarget {
  absPath: string;
  scope: "project" | "user";
  /** 声明该文件的引擎 id(展示用;同一文件多引擎共用是常态)。 */
  engines: string[];
  exists: boolean;
}

/** 规则语义分类(决定证据通道;移植 tmd-lint semantic.rs 口径)。 */
export type RuleKind =
  | "command"
  | "path"
  | "prohibition"
  | "style"
  | "process"
  | "reference"
  | "other";

/** 从规则文件提出的一条规则条目(行级;表格整块一条)。 */
export interface RuleItem {
  /** 所属目标内 1-based 序号(AI 批判定的对位 key)。 */
  idx: number;
  file: string;
  line: number;
  /** 表格块末行(普通行 = line)。 */
  lineEnd: number;
  text: string;
  section: string;
  kind: RuleKind;
  tokens: string[];
  pathRefs: string[];
  estTokens: number;
}

/** 会话语料里的净化后消息(采集即净化,见 corpus.ts)。 */
export interface CorpusMsg {
  sessionIdx: number;
  role: "user" | "assistant";
  text: string;
  lower: string;
  ts: number;
}

export interface CorpusCall {
  sessionIdx: number;
  detail: string;
  ts: number;
}

/** 一次体检的会话语料(项目体检 = cwd 全等过滤;附采集统计供过程页展示)。 */
export interface SessionCorpus {
  msgs: CorpusMsg[];
  calls: CorpusCall[];
  sessionCount: number;
  readFiles: number;
  perProfile: { profileId: string; sessions: number; msgs: number; calls: number }[];
}

/** 单条规则测得的证据包(AI 判定的输入;移植 tmd-lint RuleEvidence 特征面)。 */
export interface RuleEvidence {
  /** 词面触达消息数(区分度达标信号词)。 */
  hits: number;
  activeSessions: number;
  /** 最近触达时刻 ms epoch(0 = 窗口内从未)。 */
  lastSeen: number;
  touchQuote: string;
  /** 当场纠正次数(user 消息同时命中规则信号词与纠正词表)。 */
  corrections: number;
  correctionWords: string[];
  correctionQuotes: string[];
  /** 工具级照做次数(命令命中/路径落点观测,硬证据)。 */
  complied: number;
  complyQuote: string;
  discTokens: string[];
  /** 有信号词但全部超高频(无区分度)= 证据引擎拒绝预判,只交 AI 裸判。 */
  unjudgeable: boolean;
  /** 从规则文本抽出的命令串(命令型;pre-commit 把关与照做匹配共用)。 */
  command: string;
}

/**
 * AI 语义判定输出。tmd-lint 七态里「机器把关(enforced)」由 pre-commit
 * 确定性先判、「已拍板(settled)」由本地指纹折叠,均不入 AI 取值域。
 */
export type LintVerdict = "working" | "violated" | "touched" | "dormant" | "unverifiable";

export type LintAdvice = "keep" | "remove" | "archive" | "stub" | "fixpath";

export interface RuleJudgment {
  verdict: LintVerdict;
  /** 一句话判定理由(模型给,展示用)。 */
  reason: string;
  advice: LintAdvice;
}

/** 静态发现(确定性,不烧模型;移植 tmd-lint stale/drift 两类)。 */
export interface StaticFinding {
  id: string;
  kind: "stale" | "drift";
  file: string;
  text: string;
  /** fixpath 场景 = "{old}=>{new}";drift = 目标文件名。 */
  extra?: string;
  advice: LintAdvice;
}

/** 结果行 = 规则 + 证据 + 判定。 */
export interface LintRow {
  rule: RuleItem;
  evidence: RuleEvidence;
  /** null = AI 批次失败(如实标「判定失败」,不回落阈值猜测)。 */
  judgment: RuleJudgment | null;
  /** 已拍板(此前处理过,指纹命中本地记录)。 */
  settled: boolean;
}

/** 判定态固定排序(汇总条与分组顺序)。 */
export const VERDICT_ORDER: LintVerdict[] = [
  "violated",
  "working",
  "touched",
  "dormant",
  "unverifiable",
];

/** 判定态点色:violated 红 / working 绿 / touched 蓝 / dormant 黄 / 其余灰。 */
export const VERDICT_DOT: Record<LintVerdict | "failed" | "settled", string> = {
  violated: "bg-(--tmd-error)",
  working: "bg-(--tmd-ok)",
  touched: "bg-(--tmd-accent)",
  dormant: "bg-(--tmd-warn)",
  unverifiable: "bg-(--tmd-border)",
  failed: "bg-(--tmd-warn)",
  settled: "bg-(--tmd-border)",
};

/** 判定态文案(中文源串即 i18n key,渲染处 t() 包裹)。 */
export const VERDICT_LABEL: Record<LintVerdict | "failed" | "settled", string> = {
  violated: "AI 不听",
  working: "真的在做",
  touched: "只是提到",
  dormant: "没人用",
  unverifiable: "说不清",
  failed: "判定失败",
  settled: "已拍板",
};

export const ADVICE_LABEL: Record<LintAdvice, string> = {
  keep: "保持",
  remove: "删除",
  archive: "归档",
  stub: "收口 stub",
  fixpath: "修路径",
};

/** 已拍板指纹:"{来源态}|{文件}|{规则原文}"。 */
export function settledSig(kind: "violated" | "dormant", rule: RuleItem): string {
  return `${kind}|${rule.file}|${rule.text}`;
}
