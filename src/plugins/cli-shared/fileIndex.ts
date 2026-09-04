/**
 * @ 文件候选索引 ── Rust fs_walk_files(CLI 同款 ignore 语义)+ 客户端模糊匹配。
 *
 * 索引:每 workspace root 缓存 60s(fs_walk_files 对大仓是百毫秒级 IO,
 * 连续击键不能每键一次 IPC);失败不缓存(下次击键重试,不固化瞬时错误)。
 * 匹配:smart-case 子序列(fzf 风格)—— 大写字母要求精确匹配,小写双匹配;
 * 得分偏好连续片段、路径段首、basename 开头,平手取更短路径。
 */

import { ipc } from "@kernel/ipc";

const INDEX_TTL_MS = 60_000;
/** 候选条数与 Rust 侧 cap 对齐:2 万文件已是极端仓,够模糊匹配用。 */
const INDEX_CAP = 20_000;

const indexCache = new Map<string, { at: number; files: string[] }>();
const indexInflight = new Map<string, Promise<string[]>>();

/** workspace root 的全量候选(相对 posix 路径,目录带尾 /);root 空 = 无候选。 */
export async function projectFileIndex(root: string): Promise<string[]> {
  if (!root) return [];
  const hit = indexCache.get(root);
  if (hit && Date.now() - hit.at < INDEX_TTL_MS) return hit.files;
  const running = indexInflight.get(root);
  if (running) return running;
  const promise = ipc
    .fsWalkFiles(root, INDEX_CAP)
    .then((files) => {
      indexCache.set(root, { at: Date.now(), files });
      return files;
    })
    .catch(() => [] as string[]);
  indexInflight.set(root, promise);
  return promise.finally(() => indexInflight.delete(root));
}

/* 模糊匹配纯函数在 ./fuzzyFiles(零 IO,独立单测);此处转发保持既有导入路径 */
export { fuzzyFileMatch, fuzzyFileScore } from "./fuzzyFiles";

