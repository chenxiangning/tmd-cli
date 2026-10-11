/**
 * 工作台 · 枚举中文标签(生成内容/文档与 UI 共用,单点收敛防两处漂移)。
 */

import type { DocKind, TaskStatus, UpdateKind } from "./types";

export const UPDATE_KIND_LABELS: Record<UpdateKind, string> = {
  note: "记录", progress: "进展", blocker: "阻塞", decision: "决策",
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "待办", doing: "进行中", done: "已完成",
};

export const DOC_KIND_LABELS: Record<DocKind, string> = {
  markdown: "文档", file: "附件", image: "图片",
};

/** 附件大小 → 人读标签(KB/MB 感知;文档编辑器与任务详情共用一口径)。 */
export function bytes(size: number): string {
  return size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;
}
