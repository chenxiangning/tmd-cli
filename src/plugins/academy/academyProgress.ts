/**
 * 学堂学习进度 —— localStorage 持久化,按 cliId 分桶(多 CLI 互不干扰)。
 * 纯函数 + 轻订阅;结构损坏时整桶重置(教学进度丢了无所谓,不能崩 UI)。
 * 键:tmd.academy.progress.v1 → { [cliId]: { done: lessonId[]; cur: number } }
 */

import { useSyncExternalStore } from "react";

export interface CourseProgress {
  done: string[];
  cur: number;
}

const KEY = "tmd.academy.progress.v1";

let state: Record<string, CourseProgress> = load();
const subs = new Set<() => void>();

function load(): Record<string, CourseProgress> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, CourseProgress>;
    if (typeof parsed !== "object" || parsed === null) return {};
    return parsed;
  } catch {
    return {};
  }
}

function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* 配额满/隐私模式:进度降级为会话内态,不打断学习 */
  }
  for (const fn of subs) fn();
}

export function courseProgress(cliId: string): CourseProgress {
  return state[cliId] ?? { done: [], cur: 0 };
}

/** 完成标记(幂等):仅首次完成时前移指针(复习/重复打勾不推进)。 */
export function markLessonDone(cliId: string, lessonId: string, lessonCount: number): void {
  const p = courseProgress(cliId);
  if (p.done.includes(lessonId)) return;
  state = {
    ...state,
    [cliId]: { done: [...p.done, lessonId], cur: Math.min(p.cur + 1, lessonCount - 1) },
  };
  persist();
}

export function setLessonCursor(cliId: string, idx: number): void {
  const p = courseProgress(cliId);
  if (p.cur === idx) return;
  state = { ...state, [cliId]: { ...p, cur: idx } };
  persist();
}

export function resetProgress(cliId: string): void {
  state = { ...state, [cliId]: { done: [], cur: 0 } };
  persist();
}

export function subscribeProgress(cb: () => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

/** React 订阅;返回该课程进度切片。 */
export function useCourseProgress(cliId: string): CourseProgress {
  return useSyncExternalStore(
    subscribeProgress,
    () => courseProgress(cliId),
  );
}
