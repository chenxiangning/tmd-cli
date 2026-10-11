/**
 * 生成文档(docgen)域类型 —— 工作台 AI 文档流水线(spec:
 * docs/superpowers/specs/2026-10-11-docgen-loop-design.md)。
 * 数据布局:~/.tmd-cli/workbench/docgen/docgen.json(索引+排程+队列截尾)
 * + docs/<entryId>/v<N>.md(版本链实体,生成会话直写)+ prompt-latest.md。
 */

/** 生成态:gen 运行中 / done 有产物 / fail 失败(可重试)。 */
export type DocGenStatus = "gen" | "done" | "fail";

/** docgen 自指标记(prompt 头携带 → 会话标题携带;叶子定义供 journal 侧反向过滤,
 *  避免 journal→docgen/prompt 重图)。 */
export const DOC_GEN_MARK = "[DOC-GEN]";

import type { DocGenSourceKey } from "./templates";

/** 文档状态机(仅 done 态有意义):草稿 → 已汇报 → 已归档(点击循环)。 */
export type DocGenDocState = "draft" | "reported" | "archived";

export interface DocGenVersion {
  v: number;
  /** ISO 落盘时刻。 */
  at: string;
  engine: string;
}

/** 生成范围:全部项目 / 单项目锁定(项目详情入口)。 */
export type DocGenScope =
  | { kind: "all" }
  | { kind: "one"; projectId: string; projectName: string };

/** 周期键:ISO 周 "2026-W41" / 月 "2026-10" / 自定义 "2026-10-01_2026-10-07"。 */
export type DocGenPeriodKey = string;

/** 一份生成文档的索引条目(实体 md 在 docs/<id>/ 下,不在 JSON 里)。 */
export interface DocGenEntry {
  id: string;
  templateId: string;
  title: string;
  scope: DocGenScope;
  periodKey: DocGenPeriodKey;
  periodLabel: string;
  /** prompt 组装用周期区间(ISO 日期,含端)。 */
  periodFrom: string;
  periodTo: string;
  audience: string;
  /** 本次生成引擎 profile id(列表 meta 展示;历史版本各自记 versions[].engine)。 */
  engine: string;
  /** 事实源勾选(重新生成/排程复用)。 */
  sources: DocGenSourceKey;
  /** 附加指令(拼 prompt 尾;重试/重新生成随行)。 */
  additional?: string;
  /** 书写语言覆盖(zh/en/ja;缺省 = 跟随界面语言)。 */
  language?: string;
  status: DocGenStatus;
  docState: DocGenDocState;
  versions: DocGenVersion[];
  createdAt: string;
  updatedAt: string;
  sessionId?: string;
  error?: string;
  /** 排程自动产物标记(列表徽标)。 */
  scheduled?: boolean;
}

/** 周期排程(cron 语义:每周 weekday 的 HH:MM 生成一次)。 */
export interface DocGenSchedule {
  on: boolean;
  /** 1=周一 … 5=周五。 */
  weekday: number;
  time: string;
  templateId: string;
  engine: string;
  /** 幂等闸:已生成/补跑过的周键(2026-W41);boot 补跑与 tick 共用。 */
  lastWeekKey?: string;
}

/** docgen.json 形态。tasks = 队列恢复(截尾 50,同 journal meta.tasks 语义)。 */
export interface DocGenIndexFile {
  version: 1;
  entries: DocGenEntry[];
  schedule: DocGenSchedule;
  tasks: unknown[];
}

export const EMPTY_DOCGEN_INDEX: DocGenIndexFile = {
  version: 1,
  entries: [],
  schedule: { on: false, weekday: 5, time: "17:00", templateId: "weekly", engine: "omp" },
  tasks: [],
};
