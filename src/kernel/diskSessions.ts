/**
 * jsonl 会话目录扫描 —— omp/pi 共用的磁盘文件格式:
 * `<dir>/<iso-ts>_<uuid>.jsonl`,会话 id 从文件名解析。
 *
 * 目录约定(slug 规则/根路径)由各 CLI 插件自己声明 —— 那是 CLI 私有知识;
 * 本 helper 只管"这层目录里的 jsonl 文件 → CliDiskSession"的通用解析。
 */

import type { CliDiskSession } from "./cli";
import { ipc } from "./ipc";

export async function scanJsonlSessions(dir: string): Promise<CliDiskSession[]> {
  const files = await ipc.fsCollectFiles(dir, ".jsonl").catch(() => []);
  const sessions: CliDiskSession[] = [];
  for (const f of files) {
    // 2026-09-01T04-20-58-618Z_01a05b32-ea7a-738c-8a48-0d03dfef6824.jsonl
    const m = f.name.match(/_([0-9a-f-]{36})\.jsonl$/);
    if (!m) continue;
    sessions.push({ id: m[1], modifiedAt: f.modifiedAt, path: f.path });
  }
  return sessions;
}
