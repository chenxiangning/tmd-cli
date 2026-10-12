/**
 * 工作台 · 枚举中文标签(生成内容/文档与 UI 共用,单点收敛防两处漂移)。
 */

import type { DocKind, TaskStatus, UpdateKind } from "./types";

export const UPDATE_KIND_LABELS: Record<UpdateKind, string> = {
  note: "记录", progress: "进展", blocker: "阻塞", decision: "决策",
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "待办", doing: "进行中", review: "待验收", done: "已完成", cancelled: "已取消",
};

/** 推进钮标签(目标态口径):看板卡片与任务表共用。 */
export const TASK_ADVANCE_LABELS: Readonly<Partial<Record<TaskStatus, string>>> = {
  doing: "开始", review: "送验收", done: "完成",
};

export const DOC_KIND_LABELS: Record<DocKind, string> = {
  markdown: "文档", file: "附件", image: "图片",
};

/** 附件大小 → 人读标签(KB/MB 感知;文档编辑器与任务详情共用一口径)。 */
export function bytes(size: number): string {
  return size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;
}

/** 执行记录时间戳 → 本地「MM-DD HH:mm」(ISO 是 UTC,裸 slice 会差时区;
 *  非法输入回落原串截断,绝不抛)。 */
export function formatUpdateAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16).replace("T", " ");
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
