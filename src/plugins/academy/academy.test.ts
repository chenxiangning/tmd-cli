/**
 * 学堂进度与检索纯函数测试 —— 持久化容错、完成/指针语义、过滤排序。
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AcademyChapter, AcademyLesson } from "@kernel/academy";
import {
  courseProgress,
  markLessonDone,
  resetProgress,
  setLessonCursor,
} from "./academyProgress";
import { filterChapters, lessonIndexByChapter } from "./guideSearch";

/* jsdom 环境(仓库 vitest 默认)自带 localStorage,这里只做隔离复位。 */
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
});

beforeEach(() => {
  store.clear();
  resetProgress("t");
});

describe("学堂进度", () => {
  it("缺省进度为空;完成标记幂等;指针只前进不回退", () => {
    expect(courseProgress("t")).toEqual({ done: [], cur: 0 });
    markLessonDone("t", "a", 3);
    expect(courseProgress("t")).toEqual({ done: ["a"], cur: 1 });
    markLessonDone("t", "a", 3);
    expect(courseProgress("t").done).toEqual(["a"]);
    expect(courseProgress("t").cur).toBe(1);
    /* 显式 setLessonCursor 是用户跳转,允许回拨;重复 markDone 不推进。 */
    setLessonCursor("t", 0);
    expect(courseProgress("t").cur).toBe(0);
    markLessonDone("t", "a", 3);
    expect(courseProgress("t").cur).toBe(0);
  });

  it("指针封顶在末课;进度落盘 localStorage 且损坏时安全重置", () => {
    markLessonDone("t", "a", 2);
    markLessonDone("t", "b", 2);
    expect(courseProgress("t").cur).toBe(1);
    expect(store.get("tmd.academy.progress.v1")).toContain("b");
    store.set("tmd.academy.progress.v1", "{broken");
    vi.resetModules();
    /* 损坏后重新载入应为空桶(动态 import 校验 load 容错) */
    return import("./academyProgress").then((mod) => {
      expect(mod.courseProgress("t")).toEqual({ done: [], cur: 0 });
    });
  });
});

const CHAPTERS: AcademyChapter[] = [
  { id: "c1", title: "会话", desc: "", commands: [
    { name: "new", zh: "新会话", detail: "detail-new", examples: [] },
    { name: "clear", zh: "清空上下文", detail: "detail-clear", examples: [] },
  ] },
  { id: "c2", title: "模型", desc: "", commands: [
    { name: "model", zh: "切换模型", detail: "detail-model", examples: [] },
  ] },
];

describe("指南过滤", () => {
  it("空关键字 = 全量保序;命中按章节聚合,空章节不出现", () => {
    expect(filterChapters(CHAPTERS, "").total).toBe(3);
    const r = filterChapters(CHAPTERS, "模型");
    expect(r.total).toBe(1);
    expect(r.chapters[0]?.chapter.id).toBe("c2");
    expect(r.chapters[0]?.commands[0]?.name).toBe("model");
    expect(filterChapters(CHAPTERS, "不存在xyz").chapters).toEqual([]);
  });

  it("名称前缀命中(大小写不敏感)", () => {
    expect(filterChapters(CHAPTERS, "NEW").total).toBe(1);
    expect(filterChapters(CHAPTERS, "detail-model").total).toBe(1);
  });
});

describe("章节-课程互链", () => {
  it("首现章节映射到最早课,cheat 课无 chapter 不入映射", () => {
    const lessons: AcademyLesson[] = [
      { id: "l0", title: "a", sub: "", goal: "", points: [], chapter: "c2" },
      { id: "l1", title: "b", sub: "", goal: "", points: [], chapter: "c1" },
      { id: "l2", title: "结业", sub: "", goal: "", points: [], cheat: true },
    ];
    const map = lessonIndexByChapter(lessons);
    expect(map.get("c2")).toBe(0);
    expect(map.get("c1")).toBe(1);
    expect(map.size).toBe(2);
  });
});
