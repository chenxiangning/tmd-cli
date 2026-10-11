/**
 * 工作台 · 存储内核:内存单权威状态 + 订阅面 + 变更串行队列。
 * 高层接口分两片:store.ts(项目/任务/进展/示例)与 storeDocs.ts(文档/附件/
 * 会话 link);本文件只提供被两片共享的底座,无业务语义。
 */

import type { Project } from "./types";
import { randId } from "./types";
import { writeIndexFile } from "./workbenchFiles";

export { randId };

interface State {
  projects: Project[];
  loaded: boolean;
  error: string | null;
}

export const state: State = { projects: [], loaded: false, error: null };
const subs = new Set<() => void>();

export function emit(): void {
  for (const fn of subs) fn();
}

export function setProjects(projects: Project[], error: string | null = null): void {
  state.projects = projects;
  state.error = error;
  emit();
}

/** useSyncExternalStore 订阅面。 */
export function subscribeWorkbench(cb: () => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

export function workbenchSnapshot(): readonly Project[] {
  return state.projects;
}

export function workbenchLoadError(): string | null {
  return state.error;
}

/* ── 变更串行队列:防并发 mutation 交错写 index ── */
let tail: Promise<unknown> = Promise.resolve();
export function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = tail.then(job, job);
  tail = run.catch(() => undefined);
  return run;
}

/** 读内存(未加载时先触发加载;loader 由 store.ts 注入避免环)。 */
let ensureLoader: (() => Promise<void>) | null = null;
export function bindEnsureLoader(loader: () => Promise<void>): void {
  ensureLoader = loader;
}

export function ensureWorkbenchLoaded(): Promise<void> {
  return state.loaded ? Promise.resolve() : ensureLoader ? ensureLoader() : Promise.resolve();
}

/** 写穿模板:快照 → job → 落盘;失败回滚内存态并上抛。 */
export async function mutate(job: (projects: Project[]) => Project[]): Promise<void> {
  await enqueue(async () => {
    const snapshot = state.projects;
    const next = job([...snapshot]);
    try {
      await writeIndexFile(next);
      setProjects(next);
    } catch (e) {
      setProjects(snapshot, e instanceof Error ? e.message : String(e)); /* 回滚内存态 */
      throw e;
    }
  });
}

/** 测试与重置通道(不落盘)。 */
export function resetWorkbenchForTest(): void {
  state.projects = [];
  state.loaded = false;
  state.error = null;
  emit();
}
