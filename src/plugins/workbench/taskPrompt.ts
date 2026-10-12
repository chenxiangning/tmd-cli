/**
 * 工作台 · 任务 prompt 与状态映射(纯数据,自 TaskDetailView.tsx 拆出守
 * only-export-components)。taskPrompt = 开新会话时复制到剪贴板的任务上下文
 * + AI 回写约定(指向 AI-TASKS.md 文件规则)。
 */

import type { Project, ProjectTask, TaskStatus } from "./types";
import { toneVar } from "./tone";

/** 任务上下文 prompt(开新会话时预填;含 AI 回写文件规则引用与附件清单)。 */
export function taskPrompt(project: Project, task: ProjectTask): string {
  const attachments = task.attachments.map((att) => {
    const kb = Math.max(1, Math.round(att.size / 1024));
    return `- 附件:${att.name}(磁盘路径 ~/.tmd-cli/workbench/docs/project-${project.id}/${att.fileName},${kb} KB)`;
  });
  return [
    `我在推进任务「${task.title}」(项目:${project.name}${project.module ? ` / ${project.module}` : ""})。`,
    task.description ? `任务说明:${task.description}` : "",
    task.dueDate ? `截止:${task.dueDate}` : "",
    attachments.length > 0 ? `\n任务相关附件(${attachments.length} 个,文件名即上方括号内路径末段):` : "",
    ...attachments,
    "",
    "工作台约定:工作台数据在 ~/.tmd-cli/workbench/(规则见同目录 AI-TASKS.md)。",
    `本任务 id:${task.id}(index.json 中 projects[] 里 name 为「${project.name}」的项目下 tasks[] 按 id 定位)。`,
    "当你判断任务开始推进时把该任务 status 改为 \"doing\",交付待验收改为 \"review\",验收完成改为 \"done\" 并写 doneAt,放弃改为 \"cancelled\";只准按 AI-TASKS.md 允许的字段修改,其他数据一律不动。",
    "同时在开始推进、关键进展、交付完成三个节点向该任务 updates[] 各追加一条执行记录(kind=progress/blocker/decision/note,text 一句话说清做了什么或结果),只追加不改删。",
  ].filter(Boolean).join("\n");
}

/** 状态 → 徽标/文字色(表格行用)。 */
export function taskStatusTone(status: TaskStatus): string {
  return status === "done" ? toneVar("ok") : status === "doing" ? toneVar("info") : status === "review" ? toneVar("warn") : toneVar("muted");
}

/** 状态 → WbBadge 语气名(详情页/抽屉表格徽标用;与 taskStatusTone 同映射、出名便于组件直传)。 */
export function taskStatusBadgeTone(status: TaskStatus): string {
  return status === "done" ? "ok" : status === "doing" ? "info" : status === "review" ? "warn" : "muted";
}
