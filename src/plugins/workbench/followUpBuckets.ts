/**
 * 工作台 · 待跟进分桶(任务实体口径)。
 * 未完成任务按到期紧迫度分桶:已逾期/今天到期/本周内/更晚/未排期
 * (待跟进页专用;任务列装配已随看板表格化移除)。
 */

import { daysLeft, endOfWeek, todayISO } from "./analysis";
import type { Project } from "./types";

export type FollowUpBucketKey = "overdue" | "today" | "week" | "later" | "none";

const BUCKETS: readonly { key: FollowUpBucketKey; label: string; tone: "danger" | "warn" | "muted" }[] = [
  { key: "overdue", label: "已逾期", tone: "danger" },
  { key: "today", label: "今天到期", tone: "warn" },
  { key: "week", label: "本周内", tone: "warn" },
  { key: "later", label: "更晚", tone: "muted" },
  { key: "none", label: "未排期", tone: "muted" },
];

export interface FollowUpItem {
  key: string;
  taskId: string;
  projectId: string;
  projectName: string;
  module: string;
  title: string;
  owner: string;
  dueDate?: string;
  overdueDays: number;
}

export interface FollowUpBucket {
  key: FollowUpBucketKey;
  label: string;
  tone: "danger" | "warn" | "muted";
  items: FollowUpItem[];
  total: number;
}

/** 未完成任务按到期紧迫度分桶(含进行中;已完成不入桶)。 */
export function followUpBuckets(projects: readonly Project[], today: string = todayISO()): FollowUpBucket[] {
  const weekEnd = endOfWeek(today);
  const buckets: FollowUpBucket[] = BUCKETS.map((bucket) => ({ ...bucket, items: [], total: 0 }));
  const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));
  for (const project of projects) {
    for (const task of project.tasks) {
      if (task.status === "done") continue;
      const left = daysLeft(task.dueDate, today);
      const key: FollowUpBucketKey = left === null ? "none" : left < 0 ? "overdue" : left === 0 ? "today" : (task.dueDate ?? "") <= weekEnd ? "week" : "later";
      byKey.get(key)!.items.push({
        key: `${project.id}::${task.id}`,
        taskId: task.id,
        projectId: project.id,
        projectName: project.name,
        module: project.module || "其他项目",
        title: task.title,
        owner: task.owner || project.owner || "",
        dueDate: task.dueDate,
        overdueDays: left === null || left >= 0 ? 0 : Math.abs(left),
      });
    }
  }
  for (const bucket of buckets) {
    bucket.items.sort((a, b) => String(a.dueDate || "9999").localeCompare(String(b.dueDate || "9999")));
    bucket.total = bucket.items.length;
  }
  return buckets;
}
