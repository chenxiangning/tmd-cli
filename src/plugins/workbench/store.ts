/**
 * 工作台 · 存储·装载与项目/任务片:`~/.tmd-cli/workbench/` index.json 单权威
 * + docs 目录实体(读写守闸在 workbenchFiles.ts)。内存写穿、变更串行队列、
 * 写失败回滚(底座在 storeCore.ts;资料/关联片在 storeDocs.ts,此处集中
 * 再出口保持消费方单入口)。任务状态与执行记录可由 AI 会话按 AI-TASKS.md 规则直接改
 * index.json;reloadWorkbench() 重读磁盘同步内存。
 */

import { ipc } from "@kernel/ipc";
import { errTextDisplay } from "@kernel/errText";
import { t } from "@kernel/i18n";
import { blankProject, normalizeProject, type Project, type ProjectTask, type ProjectUpdate, type UpdateKind } from "./types";
import {
  AI_RULES_FILE, PROJECT_ID_PATTERN, createProjectId, ensureAiRulesFile,
  readIndexFile, readLegacyPrd, removeDocFile, removeLegacyPrd, writeDocFile, writeIndexFile,
} from "./workbenchFiles";
import { bindEnsureLoader, commitProjects, enqueue, getWriteError, mutate, randId, setProjects, state } from "./storeCore";

/* 集中出口:消费方只 import "./store"。 */
export {
  ensureWorkbenchLoaded, subscribeWorkbench, workbenchSnapshot, workbenchLoadError,
  workbenchLoaded, resetWorkbenchForTest,
} from "./storeCore";
export { generateSamples, clearAllProjects, clearSampleProjects } from "./storeSamples";
export { AI_RULES_FILE, INDEX_PATH, createProjectId } from "./workbenchFiles";
export {
  createDoc, readDoc, saveDoc, deleteDoc,
  attachDocFile, detachDocFile,
  attachTaskFile, detachTaskFile, linkTaskSession, unlinkTaskSession, bindTaskSessionDiskId,
} from "./storeDocs";

/* ── 装载:磁盘 → 内存(旧 PRD 分文件迁移为首篇文档)── */

async function hydrateProject(meta: Record<string, unknown> & { id: string }): Promise<{ project: Project | null; migrated: boolean }> {
  if (!PROJECT_ID_PATTERN.test(meta.id)) return { project: null, migrated: false };
  const project = normalizeProject(meta);
  let migrated = false;
  const prdMeta = meta.prd as { inline?: boolean } | undefined;
  if (prdMeta?.inline) {
    const markdown = await readLegacyPrd(meta.id);
    if (markdown !== undefined) {
      let doc = project.docs.find((d) => d.title === "PRD");
      if (!doc) {
        doc = { id: randId("d"), title: "PRD", kind: "markdown", fileName: `${randId("d")}.md`, size: 0, createdAt: project.updatedAt, updatedAt: project.updatedAt, attachments: [] };
        project.docs.unshift(doc);
      }
      try {
        await writeDocFile(project.id, doc.fileName, markdown);
        doc.size = new TextEncoder().encode(markdown).byteLength;
        await removeLegacyPrd(project.id);
        migrated = true;
      } catch { /* 下次加载重试 */ }
    }
  }
  return { project, migrated };
}

async function writeAiRules(): Promise<void> {
  await ensureAiRulesFile(`${await ipc.configHomeDir()}/.tmd-cli/workbench/${AI_RULES_FILE}`);
}

/** 全量加载本体(调用方负责串行;load/reload 共用;失败保留已载数据)。 */
async function loadLocked(): Promise<void> {
  const had = state.loaded && state.projects.length > 0;
  try {
    const metas = await readIndexFile();
    if (metas === null) {
      setProjects([], getWriteError());
      await writeAiRules().catch(() => undefined);
      return;
    }
    const allMeta = metas as Array<Record<string, unknown> & { id: string }>;
    const hydrated = await Promise.all(allMeta.map((meta) => hydrateProject(meta)));
    const projects = hydrated.map((item) => item.project).filter((project): project is Project => project !== null);
    if (hydrated.some((item) => item.migrated)) await writeIndexFile(projects);
    /* 非法 id 的记录每次装载都被静默过滤 = 用户视角「数据丢了」,错误条计数可见。 */
    const badCount = allMeta.filter((meta) => !PROJECT_ID_PATTERN.test(meta.id)).length;
    const messages = [
      badCount > 0 ? t("已忽略 {count} 条无法识别的项目记录。", { count: String(badCount) }) : null,
      getWriteError(),
    ].filter((m): m is string => m !== null);
    setProjects(projects, messages.length > 0 ? messages.join(" ") : null);
    await writeAiRules().catch(() => undefined);
  } catch (e) {
    /* 首载失败 = 空表+错误条;reload 失败保留正在展示的旧数据,只落错误条。 */
    setProjects(had ? state.projects : [], errTextDisplay(e));
  }
}

/** 全量加载(幂等;模块级 once)。文件缺失 = 首次使用,空表。 */
export function loadWorkbench(): Promise<void> {
  return enqueue(async () => {
    if (state.loaded) return;
    state.loaded = true;
    await loadLocked();
  });
}
bindEnsureLoader(loadWorkbench);

/** AI 改完 index.json 后调用:强制重读磁盘(同一队列任务内直读,防自死锁)。 */
export function reloadWorkbench(): Promise<void> {
  return enqueue(async () => {
    state.loaded = true;
    await loadLocked();
  });
}

/* ── 项目 ── */

export function createProject(partial: Partial<Project> & { name: string }): Promise<Project> {
  const project = blankProject({ id: createProjectId(), ...partial });
  return enqueue(async () => {
    const snapshot = state.projects;
    try {
      /* 示例/迁移附带的文档内容随之落盘。 */
      await Promise.all(project.docs.map(async (doc) => {
        if (doc.content !== undefined) await writeDocFile(project.id, doc.fileName, doc.content);
      }));
      await commitProjects([project, ...snapshot], snapshot);
    } catch (e) {
      /* index 未落定:全新 id 的已落盘文档整批回收,重试不再重复写。 */
      await Promise.all(project.docs.map((doc) => removeDocFile(project.id, doc.fileName)));
      throw e;
    }
    return project;
  });
}

/** 更新项目元数据(名称/模块/状态/负责人/日期/进度/说明/标签/cwd)。 */
export function updateProject(id: string, patch: Partial<Omit<Project, "id" | "tasks" | "updates" | "docs">>): Promise<void> {
  return mutate((projects) => {
    /* 目标未命中 reject(编辑中被删盘+从磁盘同步后),不照常写盘假成功。 */
    if (!projects.some((p) => p.id === id)) throw new Error(t("项目不存在或已删除。"));
    return projects.map((p) => (p.id === id ? normalizeProject({ ...p, ...patch, updatedAt: new Date().toISOString() }) : p));
  });
}

/** 批量软归档(概览「清理空壳」入口):置 archived + archivedAt,不删实体。 */
export function archiveProjects(ids: readonly string[]): Promise<void> {
  const now = new Date().toISOString();
  const idSet = new Set(ids);
  return mutate((projects) => {
    if (!projects.some((p) => idSet.has(p.id))) throw new Error(t("项目不存在或已删除。"));
    return projects.map((p) => (idSet.has(p.id) ? { ...p, archived: true, archivedAt: now, updatedAt: now } : p));
  });
}

/** 恢复单个归档项目(清 archived 标记,archivedAt 保留作取证)。 */
export function restoreProject(id: string): Promise<void> {
  return mutate((projects) => {
    if (!projects.some((p) => p.id === id)) throw new Error(t("项目不存在或已删除。"));
    return projects.map((p) => (p.id === id ? { ...p, archived: false, updatedAt: new Date().toISOString() } : p));
  });
}

export function deleteProject(id: string): Promise<void> {
  return enqueue(async () => {
    const snapshot = state.projects;
    const project = snapshot.find((p) => p.id === id);
    if (!project) throw new Error(t("项目不存在或已删除。"));
    await commitProjects(snapshot.filter((p) => p.id !== id), snapshot);
    /* index 落定后回收文档与任务附件实体(removeProjectArtifacts 同口径)。 */
    await Promise.all([
      ...project.docs.map((doc) => removeDocFile(project.id, doc.fileName)),
      ...project.tasks.flatMap((task) => task.attachments.map((att) => removeDocFile(project.id, att.fileName))),
    ]);
  });
}

/* ── 任务 ── */

export interface TaskInit {
  title: string;
  owner?: string;
  startedOn?: string;
  dueDate?: string;
  description?: string;
}

export function addTask(projectId: string, init: TaskInit): Promise<ProjectTask> {
  const now = new Date().toISOString();
  const task: ProjectTask = {
    id: randId("t"),
    title: init.title.trim(),
    status: "todo",
    owner: init.owner?.trim() || undefined,
    startedOn: init.startedOn || undefined,
    dueDate: init.dueDate || undefined,
    description: init.description?.trim() || undefined,
    order: Math.min(0, ...(state.projects.find((p) => p.id === projectId)?.tasks.map((t) => t.order) ?? [0])) - 1,
    createdAt: now,
    updatedAt: now,
    attachments: [],
    sessions: [],
    updates: [],
  };
  return enqueue(async () => {
    const snapshot = state.projects;
    if (task.title === "") throw new Error(t("任务标题不能为空"));
    if (!snapshot.some((p) => p.id === projectId)) throw new Error(t("项目不存在或已删除。"));
    const next = snapshot.map((p) => (p.id === projectId ? { ...p, tasks: [task, ...p.tasks], updatedAt: now } : p));
    await commitProjects(next, snapshot);
    return task;
  });
}

export function updateTask(projectId: string, taskId: string, patch: Partial<Pick<ProjectTask, "title" | "owner" | "dueDate" | "startedOn" | "description" | "status" | "order">>): Promise<void> {
  const now = new Date().toISOString();
  return mutate((projects) => {
    if (!projects.some((p) => p.id === projectId && p.tasks.some((t) => t.id === taskId))) throw new Error(t("任务不存在或已删除。"));
    return projects.map((p) => {
      if (p.id !== projectId) return p;
      return {
        ...p,
        updatedAt: now,
        tasks: p.tasks.map((t) => {
          if (t.id !== taskId) return t;
          const status = patch.status ?? t.status;
          /* 生命周期时间戳在唯一收口处维护:doing/review 首次落 startedOn(重开不覆盖),
           * done 落 doneAt(离开 done 即清,含取消)。 */
          const startedOn = status === "doing" || status === "review" ? (t.startedOn ?? patch.startedOn ?? now.slice(0, 10)) : (patch.startedOn ?? t.startedOn);
          return {
            ...t, ...patch, status, startedOn,
            doneAt: status === "done" ? (t.doneAt ?? now) : undefined,
            updatedAt: now,
          };
        }),
      };
    });
  });
}

export function deleteTask(projectId: string, taskId: string): Promise<void> {
  const now = new Date().toISOString();
  return enqueue(async () => {
    const snapshot = state.projects;
    const task = snapshot.find((p) => p.id === projectId)?.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error(t("任务不存在或已删除。"));
    await commitProjects(snapshot.map((p) => (p.id === projectId ? { ...p, tasks: p.tasks.filter((t) => t.id !== taskId), updatedAt: now } : p)), snapshot);
    /* index 落定后回收附件实体(clearAllProjects 同口径;单删不回收留 docs/project-* 孤儿)。 */
    await Promise.all(task.attachments.map((att) => removeDocFile(projectId, att.fileName)));
  });
}

/* ── 进展记录 ── */

export function addUpdate(projectId: string, kind: UpdateKind, text: string): Promise<void> {
  const now = new Date().toISOString();
  return mutate((projects) => {
    /* 目标未命中 reject,与 updateProject/updateTask 同契约。 */
    if (!projects.some((p) => p.id === projectId)) throw new Error(t("项目不存在或已删除。"));
    return projects.map((p) => {
      if (p.id !== projectId) return p;
      const update: ProjectUpdate = { id: randId("u"), at: now, kind, text };
      return { ...p, updates: [update, ...p.updates], updatedAt: now };
    });
  });
}

export function deleteUpdate(projectId: string, updateId: string): Promise<void> {
  return mutate((projects) => {
    const project = projects.find((p) => p.id === projectId);
    if (!project || !project.updates.some((u) => u.id === updateId)) throw new Error(t("项目不存在或已删除。"));
    return projects.map((p) => (p.id === projectId ? { ...p, updates: p.updates.filter((u) => u.id !== updateId) } : p));
  });
}
