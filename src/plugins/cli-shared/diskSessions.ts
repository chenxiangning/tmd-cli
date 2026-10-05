/**
 * jsonl 会话目录扫描(omp/pi/qoder 布局:<ISO 时间戳>_<uuid>.jsonl,文件名尾段即
 * 会话 id)—— 读头解析/缓存/批量化已拆至 sessionHead(300 行铁则;标题两段式
 * 窗口与 mtime 缓存语义不变)。手机远程与桌面同源:一次扫描收敛为
 * 1 次 fs_collect_files + 少量 chunked 批量读头 IPC。
 */

import { ipc } from "@kernel/ipc";
import type { CliDiskSession } from "@kernel/cli";
import { pruneHeadCache, readHeadMetasBatch } from "./sessionHead";

export async function scanJsonlSessions(dir: string): Promise<CliDiskSession[]> {
  const files = await ipc.fsCollectFiles(dir, ".jsonl").catch(() => []);
  /* 缓存剪除:本目录已消失的文件条目(sessionHead.pruneHeadCache,分隔符归一在彼)。 */
  pruneHeadCache(dir, new Set(files.map((f) => f.path)));
  const matched = files.flatMap((f) => {
    // 2026-09-01T04-20-58-618Z_01a05b32-ea7a-738c-8a48-0d03dfef6824.jsonl
    const m = f.name.match(/_([0-9a-f-]{36})\.jsonl$/);
    return m ? [{ id: m[1], path: f.path, modifiedAt: f.modifiedAt }] : [];
  });
  /* 一次批量读头双解析:标题 + 创建时刻(定死看板日历落位;此前 createdAt 缺位,
     resume 刷 mtime 卡片跳日)。mtime 未变走缓存,重扫免读头。 */
  const metas = await readHeadMetasBatch(matched);
  return matched
    .map((f, i) => ({
      id: f.id,
      modifiedAt: f.modifiedAt,
      createdAt: metas[i].createdAt,
      path: f.path,
      title: metas[i].title,
    }))
    .sort((a, b) => b.modifiedAt - a.modifiedAt);
}
