/**
 * 稳定字符串 hash(内核通用原语)—— 自 files/markdown/markdownBlockSegment 上移。
 * 多项式 rolling hash(31 进制)+ base36,供缓存键/文档键等跨插件场景复用。
 */

export function hashStableString(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

/** FNV-1a 32 位(marks 行指纹 / intent-canvas 目录键 / cli-shared 去重键共用;
 *  非加密,只求判等区分)。返回原始 u32,输出进制由调用方定(此前四抄各异)。 */
export function fnv1a32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
