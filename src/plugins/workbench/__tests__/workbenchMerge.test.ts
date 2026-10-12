/**
 * 工作台 · AI 并发回写保护回归(2026-10-12 实证丢失):AI 会话按 AI-TASKS.md
 * 直改 index.json(status/updates),应用任一变更整文件重写不得把它冲掉
 * (workbenchFiles.mergeExternalEdits 写前合并);轮询指纹变化要把回写自动
 * 拉进内存(storeWatch)。内存 fs 桩同 workbenchStore.test.ts 先例。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const fileByPath = new Map<string, string>();

vi.mock("@kernel/ipc", () => ({
  ipc: {
    configHomeDir: async () => "/home/tester",
    fsReadFile: async (path: string) => {
      if (!fileByPath.has(path)) throw new Error(`no such file: ${path}`);
      return fileByPath.get(path) ?? "";
    },
    fsWriteFile: async (path: string, content: string) => {
      fileByPath.set(path, content);
    },
    fsCreateDir: async () => undefined,
    fsRemovePath: async () => undefined,
    fsWriteBytesBase64: async () => undefined,
    fsReadBytesBase64: async (path: string) => {
      if (!fileByPath.has(path)) throw new Error(`no such file: ${path}`);
      return fileByPath.get(path) ?? "";
    },
  },
}));

import { addTask, createProject, ensureWorkbenchLoaded, resetWorkbenchForTest, updateTask, workbenchSnapshot } from "../store";
import { reloadIfExternalChange } from "../storeWatch";
import { INDEX_PATH } from "../workbenchFiles";

const HOME = "/home/tester";
const INDEX = INDEX_PATH(HOME);

beforeEach(() => {
  fileByPath.clear();
  resetWorkbenchForTest();
});

describe("workbench store · AI 磁盘回写合并", () => {
  const AI_UPDATE = { id: "u-a1b2c3d4", at: "2026-10-12T12:00:00.000Z", kind: "progress", text: "AI 关键进展回写" };

  async function seedTwoTasks(): Promise<{ pid: string; t1: string; t2: string }> {
    const project = await createProject({ name: "结算重构", module: "公司项目" });
    const t1 = await addTask(project.id, { title: "任务一" });
    const t2 = await addTask(project.id, { title: "任务二" });
    return { pid: project.id, t1: t1.id, t2: t2.id };
  }

  /** 模拟 AI 侧整文件回写:直改磁盘 index(不经 store,内存保持陈旧)。 */
  function aiRewriteTask(pid: string, taskId: string, patch: Record<string, unknown>, updates?: unknown[]): void {
    const index = JSON.parse(fileByPath.get(INDEX)!) as { projects: Array<Record<string, unknown>> };
    for (const project of index.projects) {
      if (project.id !== pid) continue;
      project.tasks = (project.tasks as Array<Record<string, unknown>>).map((task) =>
        task.id === taskId ? { ...task, ...patch, ...(updates ? { updates } : {}) } : task);
    }
    fileByPath.set(INDEX, JSON.stringify(index, null, 2));
  }

  function diskTask(pid: string, taskId: string): { status?: string; doneAt?: string; title?: string; updates: Array<{ id: string }> } {
    const index = JSON.parse(fileByPath.get(INDEX)!) as { projects: Array<{ id: string; tasks: Array<Record<string, unknown> & { id: string }> }> };
    const project = index.projects.find((p) => p.id === pid)!;
    return project.tasks.find((task) => task.id === taskId) as never;
  }

  function memoryTask(pid: string, taskId: string) {
    return workbenchSnapshot().find((p) => p.id === pid)!.tasks.find((task) => task.id === taskId)!;
  }

  it("未触碰任务的 AI 回写(状态+执行记录)不被应用变更冲掉", async () => {
    const { pid, t1, t2 } = await seedTwoTasks();
    aiRewriteTask(pid, t1, { status: "review", updatedAt: "2099-01-01T00:00:00.000Z" }, [AI_UPDATE]);
    await updateTask(pid, t2, { title: "应用侧改名" });
    const t1Disk = diskTask(pid, t1);
    expect(t1Disk.status).toBe("review");
    expect(t1Disk.updates.map((u) => u.id)).toContain("u-a1b2c3d4");
    /* 合并态同时进内存(否则磁盘/内存两态分叉,轮询指纹一致不再拉)。 */
    expect(memoryTask(pid, t1).status).toBe("review");
    expect(memoryTask(pid, t1).updates).toHaveLength(1);
  });

  it("同任务:应用补写时间戳更新则状态以应用为准,AI updates 仍并集保留", async () => {
    const { pid, t1 } = await seedTwoTasks();
    aiRewriteTask(pid, t1, { status: "review", updatedAt: "2020-01-01T00:00:00.000Z" }, [AI_UPDATE]);
    await updateTask(pid, t1, { status: "doing" });
    const disk = diskTask(pid, t1);
    expect(disk.status).toBe("doing");
    expect(disk.updates.map((u) => u.id)).toContain("u-a1b2c3d4");
  });

  it("同任务:AI 时间戳更新则状态/doneAt 采纳磁盘,应用补写的其余字段保留", async () => {
    const { pid, t1 } = await seedTwoTasks();
    aiRewriteTask(pid, t1, { status: "done", doneAt: "2099-01-01T00:00:00.000Z", updatedAt: "2099-01-01T00:00:00.000Z" }, [AI_UPDATE]);
    await updateTask(pid, t1, { title: "应用侧改名" });
    const disk = diskTask(pid, t1);
    expect(disk.title).toBe("应用侧改名");
    expect(disk.status).toBe("done");
    expect(disk.doneAt).toBe("2099-01-01T00:00:00.000Z");
    expect(disk.updates.map((u) => u.id)).toContain("u-a1b2c3d4");
  });

  it("轮询:磁盘原文变化才整载,无变化零 churn", async () => {
    const { pid, t1 } = await seedTwoTasks();
    await ensureWorkbenchLoaded(); /* 真实应用先装载后轮询;装载同时落指纹 */
    const before = workbenchSnapshot();
    await expect(reloadIfExternalChange()).resolves.toBeUndefined();
    expect(workbenchSnapshot()).toBe(before); /* 指纹一致:整载跳过 */
    aiRewriteTask(pid, t1, {}, [AI_UPDATE]);
    await expect(reloadIfExternalChange()).resolves.toBeUndefined();
    expect(memoryTask(pid, t1).updates.map((u) => u.id)).toContain("u-a1b2c3d4");
  });
});
