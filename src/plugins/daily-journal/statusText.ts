/**
 * 状态/便签文案推导(非组件助手:状态 chip 文案 + 便签首行预览)。
 */
import { t } from "@kernel/i18n";
import type { DayNote } from "./journalFiles";

/** 状态 chip 文案(纯表,月格/文章 tab/轴卡共用)。 */
export function statusChip(st: string): string {
  const table: Record<string, string> = {
    t: t("今日增量中"),
    p: t("待生成"),
    f: t("失败"),
    g: t("已生成"),
    n: t("无会话 · 便签日"),
  };
  return table[st];
}

/** 便签首行预览(无文本但有图时给图片计数)。 */
export function notePeekOf(note: DayNote | undefined): string {
  if (!note) return "";
  const first = note.text.split("\n").find((l) => l.trim());
  if (first) return first;
  return note.images.length ? t("{n} 张图片", { n: note.images.length }) : "";
}
