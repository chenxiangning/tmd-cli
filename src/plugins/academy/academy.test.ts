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
import { courseVersionDrift } from "./courseVersion";
import { practiceGate } from "./practiceGate";
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

/* ── 入口折叠 store(同 workspace/sectionCollapsed 契约手法:接缝桩顶替
 * useSyncExternalStore;store 是模块级单例,经 resetModules + 动态 import 取全新实例) ── */
const seam = vi.hoisted(() => ({
  subscribe: undefined as undefined | ((fn: () => void) => () => void),
  getSnapshot: undefined as undefined | (() => unknown),
}));
vi.mock("react", () => ({
  useSyncExternalStore: (subscribe: (fn: () => void) => () => void, getSnapshot: () => unknown) => {
    seam.subscribe = subscribe;
    seam.getSnapshot = getSnapshot;
    return getSnapshot();
  },
}));
vi.mock("@kernel/tabs", () => ({ openTab: vi.fn(), closeTab: vi.fn(), getTabs: () => [] }));

import type * as AcademyStores from "./academyStores";

describe("入口折叠 store", () => {
  const loadStores = async (preset?: "0" | "1"): Promise<typeof AcademyStores> => {
    if (preset) store.set("tmd.academy.entryCollapsed", preset);
    vi.resetModules();
    seam.subscribe = undefined;
    seam.getSnapshot = undefined;
    // 动态 import 例外:被测 store 是模块级单例,必须借 resetModules 取全新实例
    return import("./academyStores");
  };

  it("未预置首读展开且模块加载零写盘;预置 1 首读即折叠", async () => {
    let mod = await loadStores();
    mod.useEntryCollapsed();
    expect(seam.getSnapshot?.()).toBe(false);
    expect(store.has("tmd.academy.entryCollapsed")).toBe(false);
    mod = await loadStores("1");
    mod.useEntryCollapsed();
    expect(seam.getSnapshot?.()).toBe(true);
  });

  it("set 落盘 1/0 并通知订阅者;同值 set 静默", async () => {
    const mod = await loadStores();
    mod.useEntryCollapsed();
    const seen: unknown[] = [];
    seam.subscribe!(() => void seen.push(seam.getSnapshot?.()));
    mod.setEntryCollapsed(true);
    mod.setEntryCollapsed(true);
    expect(store.get("tmd.academy.entryCollapsed")).toBe("1");
    expect(seen).toEqual([true]);
    mod.setEntryCollapsed(false);
    expect(store.get("tmd.academy.entryCollapsed")).toBe("0");
    expect(seen).toEqual([true, false]);
  });
});

describe("courseVersionDrift(课程过期判定)", () => {
  it("一致(含 v 前缀/空白书写差异)= 不提示", () => {
    expect(courseVersionDrift("18.3.1", "18.3.1")).toBeNull();
    expect(courseVersionDrift("18.3.1", " v18.3.1 ")).toBeNull();
  });

  it("不一致返回双方原文;任一缺失不提示(宁漏勿扰)", () => {
    expect(courseVersionDrift("18.3.1", "19.0.0")).toEqual({ source: "18.3.1", installed: "19.0.0" });
    expect(courseVersionDrift("18.3.1", null)).toBeNull();
    expect(courseVersionDrift("", "19.0.0")).toBeNull();
  });
});

describe("practiceGate(「试一试」前置闸)", () => {
  it("有输入框且引擎匹配/引擎不可知 = 放行", () => {
    expect(practiceGate({ cliId: "omp", hasComposer: true, activeEngine: "omp" })).toBeNull();
    expect(practiceGate({ cliId: "omp", hasComposer: true, activeEngine: null })).toBeNull();
  });

  it("无输入框 / 引擎不符 = 引导文案(不插命令不结课)", () => {
    expect(practiceGate({ cliId: "omp", hasComposer: false, activeEngine: null })).toContain("先打开");
    expect(practiceGate({ cliId: "omp", hasComposer: true, activeEngine: "pi" })).toContain("切换后再试");
  });
});
