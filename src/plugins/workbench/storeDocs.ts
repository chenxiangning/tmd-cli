/**
 * 工作台 · 存储·资料与关联片:项目文档(markdown,附件/图片绑在文档上)、
 * 任务附件、任务↔会话 link。实体文件落 docs 目录,index 只存轻元数据;
 * index 写失败回滚内存态并清理半态实体文件。经 store.ts 集中再出口给消费方。
 */

import type { Attachment, ProjectDoc, TaskSessionLink } from "./types";
import { errTextDisplay } from "@kernel/errText";
import { enqueue, markWriteError, mutate, randId, setProjects, state } from "./storeCore";
import { readDocText, removeDocFile, safeAttachFileName, writeDocBytes, writeDocFile, writeIndexFile } from "./workbenchFiles";

/* ── 项目文档 ── */

export function createDoc(projectId: string, init: { title: string; markdown?: string }): Promise<ProjectDoc> {
  const now = new Date().toISOString();
  const doc: ProjectDoc = {
    id: randId("d"),
    title: init.title.trim() || "未命名文档",
    kind: "markdown",
    fileName: `${randId("d")}.md`,
    size: 0,
    createdAt: now,
    updatedAt: now,
    attachments: [],
    content: init.markdown ?? "",
  };
  return enqueue(async () => {
    const snapshot = state.projects;
    const target = snapshot.find((p) => p.id === projectId);
    if (!target) throw new Error(`项目不存在: ${projectId}`);
    await writeDocFile(projectId, doc.fileName, doc.content ?? "");
    doc.size = new TextEncoder().encode(doc.content ?? "").byteLength;
    const next = snapshot.map((p) => (p.id === projectId ? { ...p, docs: [doc, ...p.docs], updatedAt: now } : p));
    try {
      setProjects(await writeIndexFile(next));
    } catch (e) {
      markWriteError(errTextDisplay(e));
      setProjects(snapshot, errTextDisplay(e));
      throw e;
    }
    return doc;
  });
}

/** 读文档内容(markdown)。 */
export function readDoc(projectId: string, docId: string): Promise<string> {
  return enqueue(async () => {
    const project = state.projects.find((p) => p.id === projectId);
    const doc = project?.docs.find((d) => d.id === docId);
    if (!doc) throw new Error(`文档不存在: ${docId}`);
    return await readDocText(projectId, doc.fileName).then((text) => text ?? "");
  });
}

export function saveDoc(projectId: string, docId: string, patch: { title?: string; markdown?: string }): Promise<void> {
  const now = new Date().toISOString();
  return enqueue(async () => {
    const snapshot = state.projects;
    const project = snapshot.find((p) => p.id === projectId);
    const doc = project?.docs.find((d) => d.id === docId);
    if (!project || !doc) throw new Error(`文档不存在: ${docId}`);
    if (patch.markdown !== undefined) await writeDocFile(projectId, doc.fileName, patch.markdown);
    const next = snapshot.map((p) => {
      if (p.id !== projectId) return p;
      return {
        ...p,
        updatedAt: now,
        docs: p.docs.map((d) => d.id !== docId ? d : {
          ...d,
          title: patch.title?.trim() || d.title,
          size: patch.markdown !== undefined ? new TextEncoder().encode(patch.markdown).byteLength : d.size,
          updatedAt: now,
        }),
      };
    });
    try {
      setProjects(await writeIndexFile(next));
    } catch (e) {
      markWriteError(errTextDisplay(e));
      setProjects(snapshot, errTextDisplay(e));
      throw e;
    }
  });
}

export function deleteDoc(projectId: string, docId: string): Promise<void> {
  const now = new Date().toISOString();
  return enqueue(async () => {
    const snapshot = state.projects;
    const doc = snapshot.find((p) => p.id === projectId)?.docs.find((d) => d.id === docId);
    if (!doc) return;
    const next = snapshot.map((p) => (p.id === projectId ? { ...p, docs: p.docs.filter((d) => d.id !== docId), updatedAt: now } : p));
    setProjects(await writeIndexFile(next));
    await removeDocFile(projectId, doc.fileName);
  });
}

/* ── 文档附件(上传入口在文档编辑器;先落实体文件再挂元数据,失败不留半态)── */

export function attachDocFile(projectId: string, docId: string, file: { name: string; bytesBase64: string; size: number }): Promise<Attachment> {
  const now = new Date().toISOString();
  const attId = randId("a");
  const attachment: Attachment = {
    id: attId,
    name: file.name,
    fileName: safeAttachFileName(attId, file.name),
    size: file.size,
    createdAt: now,
  };
  return enqueue(async () => {
    const snapshot = state.projects;
    const project = snapshot.find((p) => p.id === projectId);
    if (!project?.docs.some((d) => d.id === docId)) throw new Error(`文档不存在: ${docId}`);
    await writeDocBytes(projectId, attachment.fileName, file.bytesBase64);
    const next = snapshot.map((p) => {
      if (p.id !== projectId) return p;
      return {
        ...p,
        updatedAt: now,
        docs: p.docs.map((d) => (d.id === docId ? { ...d, attachments: [...d.attachments, attachment], updatedAt: now } : d)),
      };
    });
    try {
      setProjects(await writeIndexFile(next));
    } catch (e) {
      markWriteError(errTextDisplay(e));
      setProjects(snapshot, errTextDisplay(e));
      await removeDocFile(projectId, attachment.fileName);
      throw e;
    }
    return attachment;
  });
}

export function detachDocFile(projectId: string, docId: string, attachmentId: string): Promise<void> {
  const now = new Date().toISOString();
  return enqueue(async () => {
    const snapshot = state.projects;
    const att = snapshot.find((p) => p.id === projectId)?.docs.find((d) => d.id === docId)?.attachments.find((a) => a.id === attachmentId);
    if (!att) return;
    const next = snapshot.map((p) => {
      if (p.id !== projectId) return p;
      return {
        ...p,
        updatedAt: now,
        docs: p.docs.map((d) => (d.id === docId ? { ...d, attachments: d.attachments.filter((a) => a.id !== attachmentId), updatedAt: now } : d)),
      };
    });
    setProjects(await writeIndexFile(next));
    await removeDocFile(projectId, att.fileName);
  });
}

/* ── 任务附件 ── */

/** 上传附件(先落实体文件,再挂到任务;二选一失败不留半态)。 */
export function attachTaskFile(projectId: string, taskId: string, file: { name: string; bytesBase64: string; size: number }): Promise<Attachment> {
  const now = new Date().toISOString();
  const attId = randId("a");
  const attachment: Attachment = {
    id: attId,
    name: file.name,
    fileName: safeAttachFileName(attId, file.name),
    size: file.size,
    createdAt: now,
  };
  return enqueue(async () => {
    const snapshot = state.projects;
    const project = snapshot.find((p) => p.id === projectId);
    if (!project?.tasks.some((t) => t.id === taskId)) throw new Error(`任务不存在: ${taskId}`);
    await writeDocBytes(projectId, attachment.fileName, file.bytesBase64);
    const next = snapshot.map((p) => {
      if (p.id !== projectId) return p;
      return {
        ...p,
        updatedAt: now,
        tasks: p.tasks.map((t) => (t.id === taskId ? { ...t, attachments: [...t.attachments, attachment], updatedAt: now } : t)),
      };
    });
    try {
      setProjects(await writeIndexFile(next));
    } catch (e) {
      markWriteError(errTextDisplay(e));
      setProjects(snapshot, errTextDisplay(e));
      await removeDocFile(projectId, attachment.fileName);
      throw e;
    }
    return attachment;
  });
}

export function detachTaskFile(projectId: string, taskId: string, attachmentId: string): Promise<void> {
  const now = new Date().toISOString();
  return enqueue(async () => {
    const snapshot = state.projects;
    const att = snapshot.find((p) => p.id === projectId)?.tasks.find((t) => t.id === taskId)?.attachments.find((a) => a.id === attachmentId);
    if (!att) return;
    const next = snapshot.map((p) => {
      if (p.id !== projectId) return p;
      return {
        ...p,
        updatedAt: now,
        tasks: p.tasks.map((t) => (t.id === taskId ? { ...t, attachments: t.attachments.filter((a) => a.id !== attachmentId), updatedAt: now } : t)),
      };
    });
    setProjects(await writeIndexFile(next));
    await removeDocFile(projectId, att.fileName);
  });
}

/* ── 任务↔会话 link ── */

/** 关联会话(link-only;host=活会话 hostId,disk=CLI 磁盘会话 id)。 */
export function linkTaskSession(projectId: string, taskId: string, link: Omit<TaskSessionLink, "createdAt">): Promise<void> {
  const now = new Date().toISOString();
  return mutate((projects) =>
    projects.map((p) => {
      if (p.id !== projectId) return p;
      return {
        ...p,
        updatedAt: now,
        tasks: p.tasks.map((t) => {
          if (t.id !== taskId || t.sessions.some((s) => s.ref === link.ref)) return t;
          return { ...t, sessions: [{ ...link, createdAt: now }, ...t.sessions], updatedAt: now };
        }),
      };
    }));
}

/** 关联的 host 会话绑定到 CLI 磁盘身份后回写(幂等):会话终结后凭它 resume,
 *  语义同 kind:"disk"(见 TaskDetailView 活会话行回写与 sessionOpen 打开回落)。 */
export function bindTaskSessionDiskId(projectId: string, taskId: string, ref: string, cliSessionId: string): Promise<void> {
  return mutate((projects) =>
    projects.map((p) => {
      if (p.id !== projectId) return p;
      return {
        ...p,
        updatedAt: new Date().toISOString(),
        tasks: p.tasks.map((t) => {
          if (t.id !== taskId) return t;
          return {
            ...t,
            sessions: t.sessions.map((s) => (s.ref === ref && !s.cliSessionId ? { ...s, cliSessionId } : s)),
          };
        }),
      };
    }));
}

export function unlinkTaskSession(projectId: string, taskId: string, ref: string): Promise<void> {
  const now = new Date().toISOString();
  return mutate((projects) =>
    projects.map((p) => {
      if (p.id !== projectId) return p;
      return {
        ...p,
        updatedAt: now,
        tasks: p.tasks.map((t) => (t.id === taskId ? { ...t, sessions: t.sessions.filter((s) => s.ref !== ref), updatedAt: now } : t)),
      };
    }));
}
