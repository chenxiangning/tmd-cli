/**
 * docgen 已归档条目清理(白名单动作 b)。索引读写复用 workbench docgen
 * 已导出的纯 io 函数(paths.ts 无 React 依赖;store.ts 有,不 import)。
 * 删除语义对齐 store.terminateEntry 的整条移除路径:索引条目移除 + 实体
 * 目录 docs/<id>/ 整删(版本链 + prompt-latest.md),不可恢复。
 */

import {
  readDocGenIndex,
  removeEntryDir,
  writeDocGenIndex,
} from "@plugins/workbench/docgen/paths";
import type { DocGenEntry } from "@plugins/workbench/docgen/types";

/** 已归档条目 = docState === "archived"(状态机:草稿→已汇报→已归档)。 */
export function archivedEntries(entries: DocGenEntry[]): DocGenEntry[] {
  return entries.filter((e) => e.docState === "archived");
}

/** 删除一份已归档文档:索引回写先落,实体目录随后整删(缺目录幂等)。 */
export async function removeArchivedDoc(entryId: string): Promise<void> {
  const index = await readDocGenIndex();
  await writeDocGenIndex({
    ...index,
    entries: index.entries.filter((e) => e.id !== entryId),
  });
  /* removeEntryDir = fsRemovePath 整目录删 docs/<id>/(含版本链 + prompt-latest.md)。 */
  await removeEntryDir(entryId);
}
