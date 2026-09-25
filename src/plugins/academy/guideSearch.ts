/**
 * 指南检索 —— 纯函数,与 UI 分离(同 composer triggers/suggest 分离惯例)。
 * 匹配面:命令名前缀权重 > 名称/中文/详解/原文包含;大小写不敏感。
 */

import type { AcademyChapter, AcademyCommand, AcademyLesson } from "@kernel/academy";

export interface ChapterHits {
  chapter: AcademyChapter;
  commands: AcademyCommand[];
}

export interface FilterResult {
  chapters: ChapterHits[];
  /** 命中命令总数(命中章节内命令数之和)。 */
  total: number;
}

/** 空关键字 = 全量(保序);有关键字 = 命中章节 + 命中命令,空章节不出现。 */
export function filterChapters(
  chapters: readonly AcademyChapter[],
  keyword: string,
): FilterResult {
  const kw = keyword.trim().toLowerCase();
  if (!kw) {
    return {
      chapters: chapters.map((chapter) => ({ chapter, commands: [...chapter.commands] })),
      total: chapters.reduce((acc, ch) => acc + ch.commands.length, 0),
    };
  }
  const out: ChapterHits[] = [];
  let total = 0;
  for (const chapter of chapters) {
    const commands = chapter.commands.filter((c) =>
      commandMatches(c, kw),
    );
    if (commands.length === 0) continue;
    out.push({ chapter, commands });
    total += commands.length;
  }
  return { chapters: out, total };
}

function commandMatches(c: AcademyCommand, kw: string): boolean {
  if (c.name.toLowerCase().startsWith(kw)) return true;
  return `${c.name} ${c.zh} ${c.detail} ${c.en ?? ""}`.toLowerCase().includes(kw);
}

/** 章节 → 入门课下标映射(指南「去学」互链;无对应课 = undefined)。 */
export function lessonIndexByChapter(
  lessons: readonly Pick<AcademyLesson, "id" | "chapter">[],
): Map<string, number> {
  const map = new Map<string, number>();
  lessons.forEach((l, idx) => {
    if (l.chapter && !map.has(l.chapter)) map.set(l.chapter, idx);
  });
  return map;
}
