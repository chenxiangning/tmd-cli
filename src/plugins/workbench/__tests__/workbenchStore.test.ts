/**
 * 工作台存储层测试:索引/文档实体落盘形态、文档 CRUD、附件上传与删除、
 * 任务会话 link、旧 PRD 迁移、AI 规则文件、写失败回滚、示例幂等、清空。
 * 内存 fs 桩 mirror intent-canvas storageTransaction 先例。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const fileByPath = new Map<string, string>();
const blockWrites = new Set<string>();

vi.mock("@kernel/ipc", () => ({
  ipc: {
    configHomeDir: async () => "/home/tester",
    fsReadFile: async (path: string) => {
      if (!fileByPath.has(path)) throw new Error(`no such file: ${path}`);
      return fileByPath.get(path) ?? "";
    },
    fsWriteFile: async (path: string, content: string) => {
      if (blockWrites.has(path)) {
        blockWrites.delete(path);
        throw new Error(`injected write failure: ${path}`);
      }
      fileByPath.set(path, content);
    },
    fsWriteBytesBase64: async (path: string, base64: string) => {
      if (blockWrites.has(path)) {
        blockWrites.delete(path);
        throw new Error(`injected write failure: ${path}`);
      }
      fileByPath.set(path, base64);
    },
    fsReadBytesBase64: async (path: string) => {
      if (!fileByPath.has(path)) throw new Error(`no such file: ${path}`);
      return fileByPath.get(path) ?? "";
    },
    fsCreateDir: async () => undefined,
    fsRemovePath: async (path: string) => {
      fileByPath.delete(path);
    },
  },
}));

import {
  AI_RULES_FILE, INDEX_PATH, addUpdate, attachDocFile, clearAllProjects, clearSampleProjects, createDoc, createProject, createProjectId,
  deleteDoc, deleteProject, deleteUpdate, detachDocFile, detachTaskFile, ensureWorkbenchLoaded, generateSamples, linkTaskSession,
  readDoc, reloadWorkbench, resetWorkbenchForTest, subscribeWorkbench, unlinkTaskSession,
  updateTask, workbenchLoadError, workbenchSnapshot,
} from "../store";
import { DOCS_DIR, DOC_FILE, PROJECT_PATH } from "../workbenchFiles";
import { buildSampleProjects } from "../sample";

const HOME = "/home/tester";
const INDEX = INDEX_PATH(HOME);
const DOCS = (pid: string) => DOCS_DIR(HOME, pid);

beforeEach(() => {
  fileByPath.clear();
  blockWrites.clear();
  resetWorkbenchForTest();
});

async function seedProject(): Promise<string> {
  const project = await createProject({ name: "结算重构", module: "公司项目", cwd: "/tmp/wb-ws" });
  return project.id;
}

describe("workbench store · 项目与文档", () => {
  it("createProject:索引轻元数据;AI 规则文件首载生成", async () => {
    const created = await createProject({ name: "结算重构" });
    const index = JSON.parse(fileByPath.get(INDEX)!) as { version: number; projects: unknown[] };
    expect(index.version).toBe(2);
    expect(index.projects).toHaveLength(1);
    await ensureWorkbenchLoaded();
    expect(fileByPath.has(`${HOME}/.tmd-cli/workbench/${AI_RULES_FILE}`)).toBe(true);
    expect(createProjectId()).toMatch(/^p-[a-z0-9]+-[a-z0-9-]+$/);
    void created;
  });

  it("文档 CRUD:实体内容落 docs 目录,index 只存元数据;读回一致", async () => {
    const pid = await seedProject();
    const doc = await createDoc(pid, { title: "重构 PRD", markdown: "# 目标\n拆服务" });
    expect(fileByPath.get(DOC_FILE(HOME, pid, doc.fileName))).toContain("拆服务");
    const index = JSON.parse(fileByPath.get(INDEX)!) as { projects: Array<{ docs: Array<{ title: string; size: number }> }> };
    expect(index.projects[0].docs[0].title).toBe("重构 PRD");
    expect(index.projects[0].docs[0].size).toBeGreaterThan(0);
    expect(JSON.stringify(index)).not.toContain("拆服务");
    await expect(readDoc(pid, doc.id)).resolves.toContain("拆服务");
    await saveAndCheck(pid, doc.id);
  });

  async function saveAndCheck(pid: string, docId: string): Promise<void> {
    const { saveDoc } = await import("../store");
    await saveDoc(pid, docId, { markdown: "# v2" });
    await expect(readDoc(pid, docId)).resolves.toBe("# v2");
    await deleteDoc(pid, docId);
    expect([...fileByPath.keys()].filter((p) => p.startsWith(DOCS(pid)))).toHaveLength(0);
    const after = JSON.parse(fileByPath.get(INDEX)!) as { projects: Array<{ docs: unknown[] }> };
    expect(after.projects[0].docs).toHaveLength(0);
  }

  it("文档附件:字节落盘、挂到 markdown 本档;卸载删实体并清元数据", async () => {
    const pid = await seedProject();
    const doc = await createDoc(pid, { title: "重构 PRD", markdown: "# 目标" });
    const att = await attachDocFile(pid, doc.id, { name: "设计图.png", bytesBase64: "aGk=", size: 2 });
    expect(fileByPath.has(DOC_FILE(HOME, pid, att.fileName))).toBe(true);
    const index = JSON.parse(fileByPath.get(INDEX)!) as { projects: Array<{ docs: Array<{ attachments: Array<{ id: string }> }> }> };
    expect(index.projects[0].docs[0].attachments).toHaveLength(1);
    await detachDocFile(pid, doc.id, att.id);
    expect([...fileByPath.keys()].filter((p) => p.startsWith(DOCS(pid)))).toHaveLength(1); /* 只剩 markdown 本体 */
    const after = JSON.parse(fileByPath.get(INDEX)!) as { projects: Array<{ docs: Array<{ attachments: unknown[] }> }> };
    expect(after.projects[0].docs[0].attachments).toHaveLength(0);
  });

  it("旧 PRD 迁移:inline 分文件 → docs 首篇 + 旧文件清理;reloadWorkbench 重读磁盘", async () => {
    const pid = "p-legacy";
    fileByPath.set(INDEX, JSON.stringify({ version: 1, projects: [{ id: pid, name: "旧项目", prd: { inline: true }, tags: [], createdAt: "2026-01-01", updatedAt: "2026-01-01", updates: [], tasks: [] }] }));
    fileByPath.set(PROJECT_PATH(HOME, pid), JSON.stringify({ markdown: "# 旧 PRD" }));
    await reloadWorkbench();
    const project = workbenchSnapshot().find((p) => p.id === pid);
    expect(project?.docs).toHaveLength(1);
    expect(project?.docs[0].title).toBe("PRD");
    expect(project?.docs[0].size).toBeGreaterThan(0);
    expect(fileByPath.has(PROJECT_PATH(HOME, pid))).toBe(false);
    expect(fileByPath.get(DOC_FILE(HOME, pid, project!.docs[0].fileName))).toContain("旧 PRD");
    /* index 已回写为 v2(迁移回写)。 */
    const index = JSON.parse(fileByPath.get(INDEX)!) as { version: number };
    expect(index.version).toBe(2);
  });
});

describe("workbench store · 任务扩展", () => {
  it("addTask 带描述/日期;updateTask 改状态清写 doneAt;description 可编辑", async () => {
    const pid = await seedProject();
    const { addTask } = await import("../store");
    const task = await addTask(pid, { title: "契约测试", description: "三条主链路", dueDate: "2026-10-20" });
    await updateTask(pid, task.id, { status: "doing" });
    await updateTask(pid, task.id, { description: "三条主链路 + 冲正" });
    const stored = workbenchSnapshot()[0].tasks[0];
    expect(stored.description).toBe("三条主链路 + 冲正");
    expect(stored.status).toBe("doing");
    expect(stored.startedOn).toBeTruthy();
    await updateTask(pid, task.id, { status: "done" });
    expect(workbenchSnapshot()[0].tasks[0].doneAt).toBeTruthy();
    await updateTask(pid, task.id, { status: "doing" });
    const reopened = workbenchSnapshot()[0].tasks[0];
    expect(reopened.doneAt).toBeUndefined();
    expect(reopened.startedOn).toBeTruthy();
  });

  it("linkTaskSession:同 ref 幂等;unlink 移除", async () => {
    const pid = await seedProject();
    const { addTask } = await import("../store");
    const task = await addTask(pid, { title: "联调" });
    await linkTaskSession(pid, task.id, { kind: "host", ref: "pty-1", profileId: "omp", title: "联调会话" });
    await linkTaskSession(pid, task.id, { kind: "host", ref: "pty-1", profileId: "omp", title: "联调会话" });
    expect(workbenchSnapshot()[0].tasks[0].sessions).toHaveLength(1);
    await unlinkTaskSession(pid, task.id, "pty-1");
    expect(workbenchSnapshot()[0].tasks[0].sessions).toHaveLength(0);
  });

  it("attachTaskFile:字节落盘 + 元数据;index 写失败回滚且实体清理;detach 删文件", async () => {
    const pid = await seedProject();
    const { addTask } = await import("../store");
    const task = await addTask(pid, { title: "带附件" });
    const att = await (await import("../store")).attachTaskFile(pid, task.id, { name: "流程图.png", bytesBase64: "aGk=", size: 2 });
    expect(att.fileName.endsWith(".png")).toBe(true);
    expect(workbenchSnapshot()[0].tasks[0].attachments).toHaveLength(1);
    blockWrites.add(INDEX);
    await expect((await import("../store")).attachTaskFile(pid, task.id, { name: "第二张.png", bytesBase64: "aGk=", size: 2 })).rejects.toThrow("injected");
    expect(workbenchSnapshot()[0].tasks[0].attachments).toHaveLength(1);
    expect([...fileByPath.keys()].filter((p) => p.includes("第二张"))).toHaveLength(0);
    await detachTaskFile(pid, task.id, att.id);
    expect(workbenchSnapshot()[0].tasks[0].attachments).toHaveLength(0);
    expect(fileByPath.has(DOC_FILE(HOME, pid, att.fileName))).toBe(false);
  });

  it("deleteDoc:先写 index 后删实体;index 写失败时实体与元数据都保留", async () => {
    const pid = await seedProject();
    const doc = await createDoc(pid, { title: "删除序" });
    blockWrites.add(INDEX);
    await expect(deleteDoc(pid, doc.id)).rejects.toThrow("injected");
    expect(workbenchSnapshot()[0].docs).toHaveLength(1);
    expect(fileByPath.has(DOC_FILE(HOME, pid, doc.fileName))).toBe(true);
  });
});

describe("workbench store · 数据安全", () => {
  it("loadLocked:AI 规则文件写失败不吞已加载的项目", async () => {
    await seedProject();
    blockWrites.add(`${HOME}/.tmd-cli/workbench/${AI_RULES_FILE}`);
    resetWorkbenchForTest();
    await ensureWorkbenchLoaded();
    expect(workbenchSnapshot()).toHaveLength(1);
    expect(workbenchLoadError()).toBeNull();
  });

  it("索引写失败回滚内存态并落 error", async () => {
    blockWrites.add(INDEX);
    await expect(createProject({ name: "会失败" })).rejects.toThrow("injected");
    expect(workbenchSnapshot()).toHaveLength(0);
    expect(workbenchLoadError()).toContain("injected");
  });

  it("addUpdate/deleteUpdate 目标未命中 reject 不假成功(与 updateProject 同契约)", async () => {
    const pid = await seedProject();
    await expect(addUpdate("p-missing", "note", "进展")).rejects.toThrow("项目不存在或已删除");
    await expect(deleteUpdate(pid, "u-missing")).rejects.toThrow("项目不存在或已删除");
    await addUpdate(pid, "note", "真实进展");
    expect(workbenchSnapshot().find((p) => p.id === pid)!.updates).toHaveLength(1);
    await deleteUpdate(pid, workbenchSnapshot().find((p) => p.id === pid)!.updates[0].id);
    expect(workbenchSnapshot().find((p) => p.id === pid)!.updates).toHaveLength(0);
  });

  it("generateSamples 幂等且示例文档落盘;clearAllProjects 清实体", async () => {
    await generateSamples(() => buildSampleProjects("2026-10-10"));
    expect(workbenchSnapshot()).toHaveLength(12);
    const withDocs = workbenchSnapshot().find((p) => p.docs.length > 0);
    expect(withDocs).toBeDefined();
    expect(fileByPath.has(DOC_FILE(HOME, withDocs!.id, withDocs!.docs[0].fileName))).toBe(true);
    await generateSamples(() => buildSampleProjects("2026-10-10"));
    expect(workbenchSnapshot()).toHaveLength(12);
    await clearAllProjects();
    expect(workbenchSnapshot()).toHaveLength(0);
    expect([...fileByPath.keys()].filter((p) => p.startsWith(DOCS(withDocs!.id)) && p !== DOCS(withDocs!.id))).toHaveLength(0);
  });

  it("clearSampleProjects 只删「示例」标签项目并清落盘实体;无示例时返回 0", async () => {
    await generateSamples(() => buildSampleProjects("2026-10-10"));
    const realId = await seedProject();
    expect(workbenchSnapshot()).toHaveLength(13);
    const sample = workbenchSnapshot().find((p) => p.tags.includes("示例") && p.docs.length > 0)!;
    await expect(clearSampleProjects()).resolves.toBe(12);
    expect(workbenchSnapshot().map((p) => p.id)).toEqual([realId]);
    const index = JSON.parse(fileByPath.get(INDEX)!) as { projects: Array<{ id: string }> };
    expect(index.projects.map((p) => p.id)).toEqual([realId]);
    expect([...fileByPath.keys()].filter((p) => p.startsWith(DOCS(sample.id)) && p !== DOCS(sample.id))).toHaveLength(0);
    await expect(clearSampleProjects()).resolves.toBe(0);
    /* 清理后可重新生成:幂等口径不受清理影响,示例文档重新落盘。 */
    await generateSamples(() => buildSampleProjects("2026-10-10"));
    expect(workbenchSnapshot()).toHaveLength(13);
    expect(fileByPath.has(DOC_FILE(HOME, sample.id, sample.docs[0].fileName))).toBe(true);
  });

  it("deleteProject 移除索引项;首用(索引缺失)= 空表", async () => {
    const pid = await seedProject();
    await deleteProject(pid);
    expect(workbenchSnapshot()).toHaveLength(0);
    resetWorkbenchForTest();
    await ensureWorkbenchLoaded();
    expect(workbenchSnapshot()).toHaveLength(0);
    expect(workbenchLoadError()).toBeNull();
  });

  it("订阅面在回滚时收到通知", async () => {
    let notified = false;
    const off = subscribeWorkbench(() => { notified = true; });
    blockWrites.add(INDEX);
    await expect(createProject({ name: "再失败" })).rejects.toThrow();
    expect(notified).toBe(true);
    off();
  });
});
