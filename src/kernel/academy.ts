/**
 * CLI 学堂课程注册表 —— 多 CLI 通用的引导学习契约(cli-* 生产者 + academy
 * feature 插件消费者)。同 sidebarActions 先例:注册表只认课程,不认识任何
 * 具体 CLI;omp/claude/codex 的命令目录与课程内容全在各自 cli-* 插件侧。
 *
 * 数据纪律:课程内容是源 CLI 的私有知识(命令语义、示例),绝不进 kernel;
 * 这里只有结构契约与注册机制。设计:docs/superpowers/specs/2026-09-25-cli-academy-design.md
 */

import { createSubscribable } from "./subscribable";

/** 四段式示例:场景(何时走到这步)/输入/回显/预期(发生什么 + 意味着什么 + 下一步)。 */
export interface AcademyExample {
  sc: string;
  i: string;
  o: string;
  e: string;
}

/** 子命令原文面(名称/官方英文描述/usage 提示)。 */
export interface AcademySubCommand {
  name: string;
  en?: string;
  usage?: string;
}

/** 一条命令的教学卡:zh 一句话定位,detail 讲「为什么需要它」,examples 可跟做。 */
export interface AcademyCommand {
  name: string;
  zh: string;
  en?: string;
  detail: string;
  usage?: string;
  /** 在 tmd-cli 里怎么用(静态文案;有程序化入口时用 course.openPanel)。 */
  how?: string;
  examples: AcademyExample[];
  subs?: AcademySubCommand[];
}

export interface AcademyChapter {
  id: string;
  title: string;
  desc: string;
  commands: AcademyCommand[];
}

/** 一课:目标 + 要点 + 终端打字演示 + 练习;cheat = 结业速查课(只渲染速查表)。 */
export interface AcademyLesson {
  id: string;
  title: string;
  sub: string;
  goal: string;
  points: string[];
  /** 指向 chapters[].id(指南「去学」互链;结业课可缺省)。 */
  chapter?: string;
  demo?: Array<[cmd: string, out: string]>;
  practice?: string;
  practiceWhy?: string;
  cheat?: boolean;
}

/** 一份课程 = 一个 CLI 的完整学堂内容。cliId 对齐 CliProfile.id。 */
export interface AcademyCourse {
  cliId: string;
  title: string;
  /** 数据提取时的源 CLI 版本(升级重提时更新)。 */
  sourceVersion: string;
  chapters: AcademyChapter[];
  lessons: AcademyLesson[];
  /** 二期扩展:某命令在 tmd-cli 里有对应面板时的真实打开回调(不提供 = 无徽章)。 */
  openPanel?: (commandName: string) => void;
}

const state: { courses: readonly AcademyCourse[] } = { courses: [] };
const store = createSubscribable(state);

/** 注册课程(插件 activate 内调用)。cliId 重复抛错,与 registerSidebarAction 同纪律。 */
export function registerAcademyCourse(course: AcademyCourse): void {
  if (state.courses.some((c) => c.cliId === course.cliId)) {
    throw new Error(`学堂课程重复注册: ${course.cliId}`);
  }
  state.courses = [...state.courses, course];
  store.commit({ courses: state.courses });
}

/** 撤销注册(插件卸载/热替换;cliId 未注册时静默,幂等)。 */
export function removeAcademyCourse(cliId: string): void {
  if (!state.courses.some((c) => c.cliId === cliId)) return;
  state.courses = state.courses.filter((c) => c.cliId !== cliId);
  store.commit({ courses: state.courses });
}

export function getAcademyCourses(): readonly AcademyCourse[] {
  return state.courses;
}

export function getAcademyCourse(cliId: string): AcademyCourse | undefined {
  return state.courses.find((c) => c.cliId === cliId);
}

/** useSyncExternalStore 订阅面。 */
export function subscribeAcademyCourses(cb: () => void): () => void {
  return store.subscribe(cb);
}

/** React 订阅;快照切片,引用稳定。 */
export function useAcademyCourses(): readonly AcademyCourse[] {
  return store.useStore((s) => s.courses);
}
