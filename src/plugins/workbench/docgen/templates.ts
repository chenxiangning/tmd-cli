/**
 * docgen 模板库 —— 内置模板(纯数据+周期计算,无 IO)。
 * 每模板声明:标题规则、骨架要点(拼进 prompt 契约段)、缺省事实源与受众、
 * analysisOnly(纯提示词不 spawn,保留原「进展分析提示词」能力)。
 * 自定义模板管理留 P3;当前 analysisOnly 与内置骨架都从这里出。
 */
import type { DocGenPeriodKey } from "./types";

export interface DocGenSourceKey {
  /** projects 恒选(工作台事实基座);其余四路可勾。 */
  journal: boolean;
  sessions: boolean;
  git: boolean;
}

export interface DocGenTemplate {
  id: string;
  label: string;
  desc: string;
  /** 纯提示词模板:生成即复制,不入队不落盘(原 DocPreviewDialog 语义)。 */
  analysisOnly?: boolean;
  defaultSources: DocGenSourceKey;
  defaultAudience: string;
  /** 产物骨架要点(prompt 契约段;五段结构为解析器前提,不可删)。 */
  skeleton: string;
  /** 发版说明等模板对 git 源的强依赖标记(缺源时提示)。 */
  needsGit?: boolean;
}

/** 内置模板顺序即配置弹窗展示顺序。 */
export const DOCGEN_TEMPLATES: readonly DocGenTemplate[] = [
  {
    id: "weekly",
    label: "周报",
    desc: "本周进展/风险/下周计划,管理层口径",
    defaultSources: { journal: true, sessions: false, git: false },
    defaultAudience: "管理层",
    skeleton: [
      "- 概览:整体进度变化、新增进展数、活跃风险数、完成任务数(要点行,不写长句)",
      "- 项目进展:逐项目给进度百分比与一句话状态(只登记过的项目)",
      "- 风险与阻塞:逐条给等级(高/中/低)+ 具体事实 + 影响;没有写「无」",
      "- 行动项:下周期可执行动作,带负责人与截止(登记数据里没有的写「待定」)",
      "- 建议:基于事实的 1-3 条管理建议,每条附依据",
    ].join("\n"),
  },
  {
    id: "status",
    label: "项目状态汇报",
    desc: "单项目里程碑/偏差/决策请求",
    defaultSources: { journal: true, sessions: false, git: false },
    defaultAudience: "管理层",
    skeleton: [
      "- 概览:项目当前状态判断(正轨/偏离)与整体进度",
      "- 项目进展:该项目里程碑达成情况与偏差(对比计划)",
      "- 风险与阻塞:逐条等级(高/中/低)+ 事实 + 影响;没有写「无」",
      "- 行动项:纠偏动作,带负责人与截止",
      "- 建议:需要上级/协作方决策的事项清单",
    ].join("\n"),
  },
  {
    id: "risk",
    label: "风险清单",
    desc: "分级风险 + 缓解建议 + 负责人",
    defaultSources: { journal: true, sessions: false, git: false },
    defaultAudience: "团队",
    skeleton: [
      "- 概览:风险总数与等级分布(高/中/低各几条)",
      "- 项目进展:仅摘与风险相关的事实(进度停滞、连续未动)",
      "- 风险与阻塞:逐条等级(高/中/低)+ 触发事实 + 影响 + 缓解建议",
      "- 行动项:每条风险的缓解动作,带负责人与截止",
      "- 建议:风险处置优先级排序建议",
    ].join("\n"),
  },
  {
    id: "meeting",
    label: "会议纪要",
    desc: "决议/行动项/未决问题骨架",
    defaultSources: { journal: false, sessions: true, git: false },
    defaultAudience: "团队",
    skeleton: [
      "- 概览:讨论范围与结论一句话",
      "- 项目进展:各项目现状速览(供会上对齐)",
      "- 风险与阻塞:需要会上协调的阻塞点;没有写「无」",
      "- 行动项:会上可能的行动项骨架(负责人/截止待认领写「待定」)",
      "- 建议:议程建议与需要预读的材料",
    ].join("\n"),
  },
  {
    id: "release",
    label: "发版说明",
    desc: "从 Git 提交归类新功能/修复/破坏性变更",
    defaultSources: { journal: false, sessions: false, git: true },
    defaultAudience: "对外",
    needsGit: true,
    skeleton: [
      "- 概览:本版本提交总数与变更构成(功能/修复/其他)",
      "- 项目进展:按模块归类的功能与修复清单(从提交信息提炼,不编造)",
      "- 风险与阻塞:已知问题与破坏性变更(迁移/兼容提示);没有写「无」",
      "- 行动项:升级步骤与验证清单",
      "- 建议:面向用户的升级时机建议",
    ].join("\n"),
  },
  {
    id: "analysis",
    label: "进展分析提示词",
    desc: "只生成 prompt 并复制,不 spawn 会话",
    analysisOnly: true,
    defaultSources: { journal: false, sessions: false, git: false },
    defaultAudience: "管理层",
    skeleton: "",
  },
];

export function getDocGenTemplate(id: string): DocGenTemplate | undefined {
  return DOCGEN_TEMPLATES.find((tpl) => tpl.id === id);
}

/** 两位补零(周键/月键共用,schedule 同消费)。 */
export const pad2 = (n: number): string => String(n).padStart(2, "0");
const isoOf = (d: Date): string => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** ISO 周键(周一起算,含年跨):2026-W41。 */
export function isoWeekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${pad2(week)}`;
}

export interface DocGenPeriod {
  label: string;
  key: DocGenPeriodKey;
  from: string;
  to: string;
}

/** 周期 → 区间(ISO 日期,含端)。本周=近 7 天(含今天)——工作台登记是连续流,
 *  自然周切面对「上周五写的进展」不友好;口径与首页概览一致。 */
export function periodRange(period: string, today: string): DocGenPeriod {
  const base = new Date(`${today}T00:00:00`);
  if (period === "上周" || period === "本月") {
    if (period === "上周") {
      const to = new Date(base);
      to.setDate(to.getDate() - 7);
      const from = new Date(to);
      from.setDate(from.getDate() - 6);
      return { label: period, key: `${isoWeekKey(to)}`, from: isoOf(from), to: isoOf(to) };
    }
    const from = new Date(base.getFullYear(), base.getMonth(), 1);
    return { label: period, key: `${base.getFullYear()}-${pad2(base.getMonth() + 1)}`, from: isoOf(from), to: today };
  }
  const from = new Date(base);
  from.setDate(from.getDate() - 6);
  return { label: "本周", key: isoWeekKey(base), from: isoOf(from), to: today };
}

/** 周期中文口径清单(弹窗 seg;自定义区间留 P3)。 */
export const DOCGEN_PERIODS: readonly string[] = ["本周", "上周", "本月"];

/** 受众口径(拼 prompt 语气段)。 */
export const DOCGEN_AUDIENCES: readonly string[] = ["管理层", "团队", "对外"];
