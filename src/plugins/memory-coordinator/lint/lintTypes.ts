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
  /** sessionIdx → 会话 cwd(身份自证;null = 无 cwd)。项目口径只取与工作区
   *  cwd 全等的会话,全局口径取全部。 */
  sessionCwds: (string | null)[];
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

export type LintAdvice = "keep" | "remove" | "archive" | "stub" | "fixpath" | "write" | "hook";

export interface RuleJudgment {
  verdict: LintVerdict;
  /** 一句话判定理由(模型给,展示用)。 */
  reason: string;
  advice: LintAdvice;
}

/** 静态发现(确定性,不烧模型;missing =「你反复在说」,移植 findings_missing)。 */
export interface StaticFinding {
  id: string;
  kind: "stale" | "drift" | "missing";
  file: string;
  text: string;
  /** fixpath = "{old}=>{new}";drift = 目标文件名;missing = "{count} 次/{s} 会话"。 */
  extra?: string;
  advice: LintAdvice;
}

/** AI 识别标记(第二步:完整配置发模型逐条问「能不能识别/执行」)。 */
export interface AiMark {
  /** true = 模型明确说它能识别并遵守;false = 不能/不清晰,附原因与改写建议。 */
  recognizable: boolean;
  /** 一句话说明。 */
  reason: string;
  /** 仅 recognizable=false 时:改写后的整行文本(可直接替换原行)。 */
  rewrite?: string;
}

/** AI 识别标记(第二步:完整配置发模型逐条问「能不能识别/执行」)。 */
export interface AiMark {
  /** true = 模型明确说它能识别并遵守;false = 不能/不清晰,附原因与改写建议。 */
  recognizable: boolean;
  /** 一句话说明。 */
  reason: string;
  /** 仅 recognizable=false 时:改写后的整行文本(可直接替换原行)。 */
  rewrite?: string;
}

/** 体检口径:project = 当前工作区规则(项目会话束);global = 用户级全局规则(全部会话)。 */
export type LintScope = "project" | "global";

/** 结果行 = 规则 + 证据 + 判定 + AI 可识别标记。 */
export interface LintRow {
  rule: RuleItem;
  /** 所属口径(项目/全局,报告分区与列表徽标用)。 */
  scope: LintScope;
  /** 证据在语料测完后注入;此前的行(逐文件先上屏)为 null = 待测。 */
  evidence: RuleEvidence | null;
  /** null = AI 批次失败(如实标「判定失败」,不回落阈值猜测)或尚未判到该批。 */
  judgment: RuleJudgment | null;
  /** AI 完整配置识别标记(通读全文后给的「能否识别并遵守」结论)。 */
  aiMark?: AiMark;
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
  write: "写进 AGENTS.md",
  hook: "上 pre-commit",
};

/** 已拍板指纹:"{来源态}|{文件}|{规则原文}"。 */
export function settledSig(kind: "violated" | "dormant", rule: RuleItem): string {
  return `${kind}|${rule.file}|${rule.text}`;
}

/** 一次体检的扫描记录(历史列表数据源;rows 不入,只存统计与状态)。 */
export interface ScanRecord {
  at: number;
  cwd: string;
  engineId: string;
  model: string;
  files: number;
  rules: number;
  judged: number;
  failed: number;
  /** 语料与改写统计(旧记录缺省 = 未知,详情区降级显示)。 */
  corpusMsgs?: number;
  corpusSessions?: number;
  aiBad?: number;
  findings: number;
  engineError: string;
}

/** 汇总行数(summarizeRows 返回;failed = 判定缺失)。 */
export interface LintSummary {
  verdicts: Record<string, number>;
  failed: number;
  settled: number;
}

/** 一次应用的应用记录:保存之前与之后的内容都在,可回看可恢复。 */
export interface ApplyRecord {
  at: number;
  kind: string;
  path: string;
  before: string;
  after: string;
}
