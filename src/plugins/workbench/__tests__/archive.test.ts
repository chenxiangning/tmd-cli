/**
 * 工作台空壳批量归档(042 债批)测试:activeProjects 单点过滤、
 * 归档/恢复往返(含重载磁盘后 archived 字段保留)、批量部分命中语义。
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
    fsRemovePath: async (path: string) => {
      fileByPath.delete(path);
    },
  },
}));

import {
  INDEX_PATH, archiveProjects, createProject, ensureWorkbenchLoaded, restoreProject,
  resetWorkbenchForTest, workbenchSnapshot,
} from "../store";
import { activeProjects } from "../views";

const HOME = "/home/tester";
const INDEX = INDEX_PATH(HOME);

beforeEach(() => {
  fileByPath.clear();
  resetWorkbenchForTest();
});

describe("activeProjects · 归档单点过滤", () => {
  it("archived 项目退出,在册项目保留", () => {
    const projects = [
      { id: "a", archived: true },
      { id: "b" },
      { id: "c", archived: false },
    ] as never[];
    const active = activeProjects(projects);
    expect(active.map((p) => p.id)).toEqual(["b", "c"]);
  });
});

describe("archiveProjects / restoreProject · 软归档往返", () => {
  it("批量归档:置 archived + archivedAt,不删实体;恢复后回在册,archivedAt 留证", async () => {
    const one = await createProject({ name: "空壳甲" });
    const two = await createProject({ name: "空壳乙" });
    const real = await createProject({ name: "真项目" });

    await archiveProjects([one.id, two.id, "不存在的id"]);
    let snapshot = workbenchSnapshot();
    expect(snapshot.find((p) => p.id === one.id)?.archived).toBe(true);
    expect(snapshot.find((p) => p.id === two.id)?.archivedAt).toBeTruthy();
    expect(snapshot.find((p) => p.id === real.id)?.archived).toBe(false);
    /* 单点过滤:概览/聚焦/看板消费同一口径 */
    expect(activeProjects(snapshot).map((p) => p.id)).toEqual([real.id]);

    /* 重载磁盘:archived 字段随 index 持久化保留 */
    await ensureWorkbenchLoaded();
    snapshot = workbenchSnapshot();
    expect(snapshot.find((p) => p.id === one.id)?.archived).toBe(true);
    const index = JSON.parse(fileByPath.get(INDEX)!) as { projects: Array<{ id: string; archived?: boolean }> };
    expect(index.projects.filter((p) => p.archived === true)).toHaveLength(2);

    /* 恢复:清 archived 标记,实体未损 */
    await restoreProject(one.id);
    snapshot = workbenchSnapshot();
    const restored = snapshot.find((p) => p.id === one.id)!;
    expect(restored.archived).toBe(false);
    expect(restored.name).toBe("空壳甲");
    expect(snapshot.find((p) => p.id === two.id)?.archived).toBe(true);
  });

  it("全部 id 均未命中时 reject,不空写", async () => {
    await createProject({ name: "唯一项目" });
    await expect(archiveProjects(["nope"])).rejects.toThrow();
    await expect(restoreProject("nope")).rejects.toThrow();
  });
});
