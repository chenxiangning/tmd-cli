/**
 * 工作台 · 存储示例/清空片(自 store.ts 拆出守 300 行铁则):
 * 示例数据生成与全量/示例清空;写穿走 storeCore.commitProjects。
 */

import { commitProjects, enqueue, state } from "./storeCore";
import { removeDocFile, removeLegacyPrd, writeDocFile } from "./workbenchFiles";
import type { Project } from "./types";

/** 生成示例数据(幂等按 id 追加;示例文档内容随项目落盘)。 */
export function generateSamples(build: () => Project[]): Promise<void> {
  return enqueue(async () => {
    const snapshot = state.projects;
    const known = new Set(snapshot.map((p) => p.id));
    const samples = build().filter((p) => !known.has(p.id));
    const pendingDocs = samples.flatMap((sample) =>
      sample.docs.filter((doc) => doc.content !== undefined).map((doc) => ({ sample, doc })));
    try {
      await Promise.all(pendingDocs.map(({ sample, doc }) => writeDocFile(sample.id, doc.fileName, doc.content!)));
      await commitProjects([...samples, ...snapshot], snapshot);
    } catch (e) {
      /* index 未落定:回收已落盘示例文档,重试不再重复写。 */
      await Promise.all(pendingDocs.map(({ sample, doc }) => removeDocFile(sample.id, doc.fileName)));
      throw e;
    }
  });
}

/** 删除项目集合的落盘实体(文档/任务附件/旧 PRD;项目目录保留空壳)。 */
async function removeProjectArtifacts(projects: readonly Project[]): Promise<void> {
  await Promise.all(projects.flatMap((project) => [
    ...project.docs.map((doc) => removeDocFile(project.id, doc.fileName)),
    ...project.tasks.flatMap((task) => task.attachments.map((att) => removeDocFile(project.id, att.fileName))),
    removeLegacyPrd(project.id).catch(() => undefined),
  ]));
}

/** 清空全部项目(删除文档/附件实体;目录保留空壳)。 */
export function clearAllProjects(): Promise<void> {
  /* 快照在队列内取:与在途变更严格串行,防「index 已清、实体快照缺项」的孤儿窗口。 */
  return enqueue(async () => {
    const old = state.projects;
    await commitProjects([], old);
    await removeProjectArtifacts(old);
  });
}

/** 清理示例数据:只删带「示例」标签的项目(识别口径见 sample.ts),真实项目不动;返回清理数。 */
export function clearSampleProjects(): Promise<number> {
  return enqueue(async () => {
    const old = state.projects.filter((p) => p.tags.includes("示例"));
    if (old.length === 0) return 0;
    const next = state.projects.filter((p) => !p.tags.includes("示例"));
    await commitProjects(next, state.projects);
    await removeProjectArtifacts(old);
    return old.length;
  });
}
