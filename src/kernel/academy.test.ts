/**
 * 学堂课程注册表契约 —— 注册/重复抛错/移除幂等/订阅通知。
 */

import { describe, expect, it, vi } from "vitest";
import {
  getAcademyCourse,
  getAcademyCourses,
  registerAcademyCourse,
  removeAcademyCourse,
  subscribeAcademyCourses,
  type AcademyCourse,
} from "./academy";

function fakeCourse(cliId: string): AcademyCourse {
  return {
    cliId,
    title: `${cliId} 学堂`,
    sourceVersion: "0.0.0",
    chapters: [
      {
        id: "ch1",
        title: "一章",
        desc: "desc",
        commands: [
          { name: "cmd-a", zh: "甲", detail: "详解", examples: [{ sc: "s", i: "/cmd-a", o: "out", e: "预期" }] },
        ],
      },
    ],
    lessons: [{ id: "l1", title: "一课", sub: "1 分钟", goal: "g", points: [] }],
  };
}

describe("academy 课程注册表", () => {
  it("注册后可查,cliId 重复抛错", () => {
    const course = fakeCourse("t-a");
    registerAcademyCourse(course);
    expect(getAcademyCourse("t-a")).toBe(course);
    expect(() => registerAcademyCourse(fakeCourse("t-a"))).toThrow(/重复注册/);
    removeAcademyCourse("t-a");
  });

  it("remove 未注册时幂等静默;移除后不可查", () => {
    expect(() => removeAcademyCourse("t-absent")).not.toThrow();
    registerAcademyCourse(fakeCourse("t-b"));
    removeAcademyCourse("t-b");
    expect(getAcademyCourse("t-b")).toBeUndefined();
  });

  it("订阅者在注册/移除时收到通知,退订后不再收", () => {
    const cb = vi.fn();
    const unsub = subscribeAcademyCourses(cb);
    registerAcademyCourse(fakeCourse("t-c"));
    expect(cb).toHaveBeenCalled();
    cb.mockClear();
    unsub();
    removeAcademyCourse("t-c");
    expect(cb).not.toHaveBeenCalled();
    expect(getAcademyCourses().some((c) => c.cliId === "t-c")).toBe(false);
  });
});
