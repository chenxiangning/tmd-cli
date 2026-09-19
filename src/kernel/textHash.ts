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
