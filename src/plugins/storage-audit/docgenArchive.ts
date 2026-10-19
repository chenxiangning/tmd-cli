/**
 * docgen 已归档条目筛(白名单动作 b 的只读面)。删除动作走
 * workbench docgen store 的 removeArchivedEntry(单写者队列内,
 * 裸读写 docgen.json 会被内存单权威的整体重写静默复活)。
 */

import type { DocGenEntry } from "@plugins/workbench/docgen/types";

/** 已归档条目 = docState === "archived"(状态机:草稿→已汇报→已归档)。 */
export function archivedEntries(entries: DocGenEntry[]): DocGenEntry[] {
  return entries.filter((e) => e.docState === "archived");
}
