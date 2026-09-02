/**
 * patch LRU 缓存 —— 双重上限:50 条 + 20MB 字节预算。插入序即使用序;
 * get 命中提升为最近使用。单文件 patch(lockfile/生成代码)可达数 MB,
 * 只限条数会让 50 条满载驻留数百 MB;超预算从最久未用端淘汰。
 * key = `cwd\0path\0staged`。
 */

import type { GitFilePatch } from "@kernel/ipc";

const LRU_LIMIT = 50;
/** 字节预算(patch 文本长度近似):超限淘汰最久未用条目。 */
const LRU_BYTES = 20 * 1024 * 1024;

export class PatchLRU {
  private map = new Map<string, GitFilePatch>();
  private bytes = 0;

  get(key: string): GitFilePatch | undefined {
    const v = this.map.get(key);
    if (v) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }

  put(key: string, v: GitFilePatch): void {
    /* 先扣旧值再删:同 key 覆盖时账目必须净额更新 */
    const old = this.map.get(key);
    this.bytes -= old?.patch.length ?? 0;
    this.map.delete(key);
    /* 双上限:条数 ≤50 且字节 ≤20MB,超限从最久未用端淘汰 */
    while (
      (this.map.size >= LRU_LIMIT || this.bytes + v.patch.length > LRU_BYTES) &&
      this.map.size > 0
    ) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.bytes -= this.map.get(oldest)?.patch.length ?? 0;
      this.map.delete(oldest);
    }
    this.bytes += v.patch.length;
    this.map.set(key, v);
  }

  clear(): void {
    this.map.clear();
    this.bytes = 0;
  }
}
