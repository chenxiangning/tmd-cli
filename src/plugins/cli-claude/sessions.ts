/**
 * claude 磁盘会话扫描 —— 自 index.tsx 拆出(叶子模块,移动端 home 历史直用)。
 * 布局实证(claude 2.1.251):~/.claude/projects/<slug>/<session-uuid>.jsonl,
 * 目录即 cwd 分区,文件名即会话 id。
 */

import { ipc } from "@kernel/ipc";
import type { CliDiskSession } from "@kernel/cli";
import { readHeadMetasBatch } from "../cli-shared/sessionHead";

/**
 * claude 磁盘会话存储(实证自 ~/.claude/projects/ 真实目录,claude 2.1.251):
 * - 目录 = ~/.claude/projects/<slug>/<session-uuid>.jsonl(文件名即会话 id)
 * - slug 规则: cwd 中所有非 [a-zA-Z0-9] 字符逐一替换为 "-"
 *   例 /Users/x/code/AI/github/mossx → -Users-x-code-AI-github-mossx
 *   例 /Users/x/.claude → -Users-x--claude (点号同样替换)
 *   例 /Users/x/code/内容分析 → -Users-x-code----- (每个非 ASCII 字符一个 -)
 * - 目录本身即 cwd 分区,无需像 codex rollout 那样读文件头过滤。
 */
export function claudeProjectSlug(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

export async function claudeSessionsDir(cwd: string): Promise<string | null> {
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return null;
  return `${home}/.claude/projects/${claudeProjectSlug(cwd)}`;
}

export async function listClaudeSessions(cwd: string): Promise<CliDiskSession[]> {
  const dir = await claudeSessionsDir(cwd);
  if (!dir) return [];
  const files = await ipc.fsCollectFiles(dir, ".jsonl").catch(() => []);
  /* 文件名即 sessionId(6b844d1a-…,直接喂 --resume);目录已按 cwd 分区,每个
     文件都值得读。批量读头(sessionHead):外网中继 N+1 读头 = 并发帽快拒 +
     链路拥塞,一次批量 + mtime 缓存把重扫收敛为 1+chunked 次 IPC;结果保持
     files 原序。一次读头双解析:标题 + createdAt(创建时刻定死看板日历落位)。 */
  const matched = files.flatMap((f) => {
    const m = f.name.match(/^([0-9a-f-]{36})\.jsonl$/);
    return m ? [{ id: m[1], path: f.path, modifiedAt: f.modifiedAt }] : [];
  });
  const metas = await readHeadMetasBatch(matched);
  return matched.map((f, i) => ({
    id: f.id,
    modifiedAt: f.modifiedAt,
    createdAt: metas[i].createdAt,
    path: f.path,
    title: metas[i].title,
  }));
}
