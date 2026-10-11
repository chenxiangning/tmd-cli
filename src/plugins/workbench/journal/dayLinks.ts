/**
 * 日↔工作台派生关联(纯函数)—— 当日会话行 → 项目/任务,运行时派生不落盘
 * (单一事实源;spec 2026-10-11-workbench-journal-merge-design.md P2):
 * - 项目:行 wsId → 工作区根,与 Project.cwd 归一(去尾斜杠)后精确相等才命中
 *   (前缀匹配会把工作区全部会话摊给其下所有项目,过关联);
 * - 任务:TaskSessionLink 命中行身份 —— disk 链:非活行按 id+profileId 双等,
 *   活行按磁盘凭证 r.disk.id(会话恢复即转活,活行 id 已换成 app 会话 id,
 *   daySessions assembleRows 契约;先例 pendingAutoDoing「host/disk 通吃」);
 *   host 链 = 活行 id(app 会话 id 全局唯一,profileId 不判)。
 */
import type { DaySessionRow } from "./daySessions";
import type { Project } from "../types";

/** 结构化最小面:kernel Workspace 的 {id, root} 子集,测试免拉内核。 */
export interface LinkWorkspace {
  id: string;
  root: string;
}

export interface DayProjectLink {
  projectId: string;
  projectName: string;
  rows: DaySessionRow[];
}

export interface DayTaskLink {
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectName: string;
}

/** 比较前归一:ProjectFormModal cwd 是自由文本(尾斜杠即永不命中,与
 * resolveWorkspaceId 前缀回退行为相悖);两侧去尾斜杠,精确匹配语义不变。 */
const normRoot = (p: string): string => p.replace(/\/+$/, "");

/** 日↔项目:命中项目的行按组聚合(组间按组内最早 startedAt 升序)。 */
export function dayProjectLinks(
  rows: DaySessionRow[],
  projects: readonly Project[],
  workspaces: LinkWorkspace[],
): DayProjectLink[] {
  const rootOfWs = new Map(workspaces.map((w) => [w.id, normRoot(w.root)]));
  const byProject = new Map<string, DayProjectLink>();
  for (const project of projects) {
    if (!project.cwd) continue;
    const target = normRoot(project.cwd);
    const wsIds = new Set(
      [...rootOfWs.entries()].filter(([, root]) => root === target).map(([id]) => id),
    );
    const hit = rows.filter((r) => r.wsId !== undefined && wsIds.has(r.wsId));
    hit.sort((a, b) => a.startedAt - b.startedAt); /* 组内按开始时刻:不依赖调用方传入序 */
    if (hit.length === 0) continue;
    byProject.set(project.id, { projectId: project.id, projectName: project.name, rows: hit });
  }
  return [...byProject.values()].sort((a, b) => a.rows[0].startedAt - b.rows[0].startedAt);
}

/** 日↔任务:任意 link 命中即出(一任务一条,不重复)。 */
export function dayTaskLinks(rows: DaySessionRow[], projects: readonly Project[]): DayTaskLink[] {
  const links: DayTaskLink[] = [];
  for (const project of projects) {
    for (const task of project.tasks) {
      const hit = task.sessions.some((link) =>
        link.kind === "disk"
          ? rows.some(
              (r) =>
                r.profileId === link.profileId &&
                (r.live ? r.disk?.id === link.ref : r.id === link.ref),
            )
          : rows.some((r) => r.live && r.id === link.ref),
      );
      if (hit) links.push({ taskId: task.id, taskTitle: task.title, projectId: project.id, projectName: project.name });
    }
  }
  return links;
}
