/**
 * 工作台 · 示例数据(移植自 projectHub shared/sample.js,任务实体化)。
 * 一个后端/全栈工程师手上常见的工作,每种项目模块各 4 个;日期相对今天,
 * 任何一天生成都成立。记录带「示例」标签,方便识别与清理。
 */

import { todayISO } from "./analysis";
import { normalizeProject, type Project, type ProjectDoc, type ProjectTask, type ProjectUpdate, type TaskStatus, type UpdateKind } from "./types";

const pad = (value: number): string => String(value).padStart(2, "0");

/** 相对今天偏移若干天的本地日历日。 */
function shift(today: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(today));
  if (!match) return today;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 相对今天偏移若干天的 ISO 时间戳。 */
function stamp(today: string, days: number): string {
  return `${shift(today, days)}T09:00:00.000Z`;
}

const update = (id: string, today: string, days: number, kind: UpdateKind, text: string): ProjectUpdate =>
  ({ id, at: stamp(today, days), kind, text });

const task = (id: string, title: string, owner: string, today: string, days: number, status: TaskStatus = "todo", description?: string): ProjectTask => ({
  id, title, status, owner, dueDate: shift(today, days), order: 0,
  description, createdAt: stamp(today, days - 1), updatedAt: stamp(today, days - 1),
  doneAt: status === "done" ? stamp(today, days) : undefined,
  attachments: [], sessions: [],
});

/** 示例文档(content 由 generateSamples 落盘)。 */
const doc = (id: string, title: string, today: string, content: string): ProjectDoc => ({
  id, title, kind: "markdown", fileName: `${id}.md`,
  size: new TextEncoder().encode(content).byteLength,
  createdAt: stamp(today, -3), updatedAt: stamp(today, -1), attachments: [], content,
});

interface SampleSpec {
  id: string; name: string; module: string;
  status?: Project["status"];
  owner?: string;
  progress?: number;
  start: number; due: number; last?: number;
  summary?: string; tags?: string[];
  updates?: ProjectUpdate[];
  tasks?: ProjectTask[];
  docs?: ProjectDoc[];
}

function make(today: string, spec: SampleSpec): Project {
  const project = normalizeProject({
    id: spec.id,
    name: spec.name,
    module: spec.module,
    status: spec.status ?? "进行中",
    owner: spec.owner ?? "我",
    dueDate: shift(today, spec.due),
    startedOn: shift(today, spec.start),
    progress: spec.progress ?? 0,
    summary: spec.summary ?? "",
    tags: ["示例", ...(spec.tags ?? [])],
    createdAt: stamp(today, spec.start),
    updatedAt: stamp(today, spec.last ?? -1),
    updates: spec.updates ?? [],
    docs: spec.docs ?? [],
    tasks: (spec.tasks ?? []).map((item, index) => ({ ...item, order: index })),
  });
  /* content 是内存字段(normalizeProject 剥掉防落 index),示例生成时回挂供落盘。 */
  const contentById = new Map((spec.docs ?? []).map((doc) => [doc.id, doc.content]));
  for (const target of project.docs) {
    const content = contentById.get(target.id);
    if (content !== undefined) target.content = content;
  }
  return project;
}

/** 生成示例项目:公司项目 4 个、日常工作 4 个、其他项目 4 个。 */
export function buildSampleProjects(today: string = todayISO()): Project[] {
  const specs: SampleSpec[] = [
    // ---------------------------------------------------------- 公司项目
    {
      id: "demo-company-1", name: "订单结算服务重构", module: "公司项目", progress: 55, start: -30, due: -2, last: -2,
      summary: "把结算逻辑从单体拆成独立服务,接口按领域重划,历史数据要能对得上。", tags: ["后端", "重构"],
      updates: [
        update("demo-company-1-u1", today, -12, "progress", "结算链路拆出独立服务,主干联调通过"),
        update("demo-company-1-u2", today, -4, "blocker", "旧系统遗留的优惠券口径没确认,验收用例写不下去"),
      ],
      tasks: [
        task("demo-company-1-t1", "补齐结算接口的契约测试", "我", today, -3, "todo", "覆盖下单/退款/冲正三条主链路,历史订单口径以财务确认结果为准。"),
        task("demo-company-1-t2", "和财务确认历史订单的结算口径", "我", today, 1, "doing", "重点:2024 年以前的优惠券冲销记录是否参与重算。"),
      ],
      docs: [doc("demo-company-1-doc1", "重构方案 PRD", today, "# 结算服务重构 PRD\n\n## 背景\n单体结算逻辑耦合严重,活动期频繁故障。\n\n## 目标\n- 拆分为独立结算服务,接口按领域重划\n- 历史数据可对账,误差为零\n\n## 验收标准\n- 契约测试全绿\n- 灰度 5% 无资损")],
    },
    {
      id: "demo-company-2", name: "数据中台订单域接入", module: "公司项目", progress: 40, start: -20, due: 2, last: -1,
      summary: "把订单库的增量变更实时打进数据中台,先跑通订单域的一张宽表。", tags: ["数据", "CDC"],
      updates: [update("demo-company-2-u1", today, -5, "progress", "订单域字段映射表确认,CDC 链路本地跑通")],
      tasks: [task("demo-company-2-t1", "联调订单域增量同步,核对 24 小时延迟", "我", today, 2)],
    },
    {
      id: "demo-company-3", name: "移动端首屏性能优化", module: "公司项目", progress: 20, start: -25, due: 8, last: -6,
      summary: "首屏从 1.8s 压到 1s 以内:拆包、图片按需、接口并行。", tags: ["前端", "性能"],
      updates: [update("demo-company-3-u1", today, -6, "note", "首屏耗时采样完成,定位到主包过大和串行请求")],
      tasks: [task("demo-company-3-t1", "拆首屏 JS 分包,砍掉未用依赖", "我", today, 3)],
    },
    {
      id: "demo-company-4", name: "灰度发布平台上线", module: "公司项目", status: "已完成", progress: 100, start: -45, due: -12, last: -12,
      summary: "按用户维度灰度的发布平台,已接入全部核心服务。", tags: ["平台", "CI/CD"],
      updates: [update("demo-company-4-u1", today, -12, "decision", "全量发布完成,回滚预案与值班流程已归档")],
      tasks: [],
    },

    // ---------------------------------------------------------- 日常工作
    {
      id: "demo-daily-1", name: "内部分享《线上问题定位实战》准备", module: "日常工作", progress: 45, start: -8, due: 2, last: -1,
      summary: "下周四内部分享,用三个真实 case 讲排查思路:从火焰图到链路日志。", tags: ["技术分享", "可观测"],
      updates: [update("demo-daily-1-u1", today, -1, "progress", "大纲和两个 case 定了,还差一个内存泄漏的分析过程")],
      tasks: [
        task("demo-daily-1-t1", "补第三个 case 的火焰图与结论", "我", today, 0),
        task("demo-daily-1-t2", "对着同事预讲一遍,控制在 40 分钟", "我", today, 1),
      ],
    },
    {
      id: "demo-daily-2", name: "Q3 技术季度汇报", module: "日常工作", progress: 35, start: -14, due: 9, last: -3,
      summary: "向主管汇报本季度技术产出:稳定性、性能、效率三块指标与下季规划。", tags: ["汇报", "OKR"],
      updates: [update("demo-daily-2-u1", today, -3, "progress", "稳定性与性能两块指标已收集完,等效率部分的埋点数据")],
      tasks: [task("demo-daily-2-t1", "补性能优化前后的对比数据与图表", "我", today, 5)],
    },
    {
      id: "demo-daily-3", name: "线上告警值班与故障复盘", module: "日常工作", progress: 70, start: -9, due: -3, last: -3,
      summary: "本周告警值班:处理 P2 告警、写复盘、把结论沉淀进值班手册。", tags: ["值班", "稳定性"],
      updates: [update("demo-daily-3-u1", today, -3, "note", "两次 P2 告警的复盘初稿写完,等负责人确认根因")],
      tasks: [task("demo-daily-3-t1", "把复盘结论同步进值班手册和监控规则", "我", today, -2)],
    },
    {
      id: "demo-daily-4", name: "依赖升级与技术债清理", module: "日常工作", progress: 15, start: -10, due: 5, last: -2,
      summary: "把几个高危依赖升到安全版本,顺手删掉两次迭代前留下的兼容代码。", tags: ["技术债", "依赖"],
      updates: [update("demo-daily-4-u1", today, -2, "note", "扫出 3 个高危依赖和 1 处废弃兼容层,升级分支已建")],
      tasks: [task("demo-daily-4-t1", "升级并跑通全量回归", "我", today, -1)],
    },

    // ---------------------------------------------------------- 其他项目
    {
      id: "demo-other-1", name: "自研服务监控小工具", module: "其他项目", status: "阻塞", progress: 15, start: -8, due: 20, last: -2,
      summary: "自己写个小工具盯接口 P99 与慢 SQL,异常时推到企业微信。", tags: ["工具", "可观测"],
      updates: [update("demo-other-1-u1", today, -2, "blocker", "等运维开采集端的只读权限,本地只能用假数据跑")],
      tasks: [task("demo-other-1-t1", "确认采集端权限范围与账号", "运维", today, 2)],
    },
    {
      id: "demo-other-2", name: "开源项目 issue 与 PR 维护", module: "其他项目", progress: 50, start: -8, due: 3, last: -1,
      summary: "维护自己那个小开源库:回 issue、审 PR、发一个小版本。", tags: ["开源", "社区"],
      updates: [update("demo-other-2-u1", today, -1, "progress", "合并了两个社区 PR,CI 全绿")],
      tasks: [task("demo-other-2-t1", "回复剩下的 6 个 issue 并打标签", "我", today, 2)],
    },
    {
      id: "demo-other-3", name: "技术笔记与博客整理", module: "其他项目", progress: 25, start: -5, due: 14, last: -4,
      summary: "把散在各处的排查笔记和源码阅读记录整理成可检索的博客。", tags: ["学习", "写作"],
      updates: [update("demo-other-3-u1", today, -4, "note", "先按主题分了 6 类:并发、存储、网络、JVM、框架源码、排查")],
      tasks: [task("demo-other-3-t1", "整理「分布式事务」一节并画流程图", "我", today, 7)],
    },
    {
      id: "demo-other-4", name: "副业小程序原型", module: "其他项目", status: "待启动", progress: 0, start: 0, due: 25, last: 0,
      summary: "先用两周做个能跑通的最小闭环,验证一下这个想法值不值得继续。", tags: ["副业", "原型"],
      updates: [],
      tasks: [task("demo-other-4-t1", "写一页验证目标与技术选型", "我", today, 3)],
    },
  ];
  return specs.map((spec) => make(today, spec));
}

/** 生成示例数据时的提示语。 */
export function sampleSummary(projects: readonly Project[]): string {
  const byModule = new Map<string, number>();
  for (const project of projects) byModule.set(project.module, (byModule.get(project.module) ?? 0) + 1);
  const detail = [...byModule.entries()].map(([name, count]) => `${name} ${count} 个`).join("、");
  return `${projects.length} 个示例项目(${detail})`;
}
